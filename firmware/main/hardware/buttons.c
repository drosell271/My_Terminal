#include "buttons.h"

#include <stdint.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define BUTTON_GREEN_GPIO GPIO_NUM_3
#define BUTTON_NEXT_GPIO GPIO_NUM_4
#define BUTTON_PREVIOUS_GPIO GPIO_NUM_5
#define DEBOUNCE_US 250000

static const char *TAG = "buttons";
static QueueHandle_t s_button_queue;
static button_action_callback_t s_callback;
static int64_t s_last_press_us[3];

static void IRAM_ATTR button_isr_handler(void *arg)
{
    gpio_num_t gpio = (gpio_num_t)(intptr_t)arg;
    xQueueSendFromISR(s_button_queue, &gpio, NULL);
}

static bool action_from_gpio(gpio_num_t gpio, button_action_t *action)
{
    if (gpio == BUTTON_GREEN_GPIO) {
        *action = BUTTON_ACTION_CURRENT_MONTH;
        return true;
    }
    if (gpio == BUTTON_NEXT_GPIO) {
        *action = BUTTON_ACTION_NEXT_MONTH;
        return true;
    }
    if (gpio == BUTTON_PREVIOUS_GPIO) {
        *action = BUTTON_ACTION_PREVIOUS_MONTH;
        return true;
    }
    return false;
}

static void button_task(void *arg)
{
    (void)arg;

    while (true) {
        button_action_t action;
        if (!buttons_wait_for_action(&action, portMAX_DELAY)) {
            continue;
        }

        if (s_callback) {
            s_callback(action);
        }
    }
}

static esp_err_t configure_button(gpio_num_t gpio)
{
    gpio_config_t config = {
        .pin_bit_mask = 1ULL << gpio,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&config));
    return gpio_isr_handler_add(gpio, button_isr_handler, (void *)(intptr_t)gpio);
}

esp_err_t buttons_init(button_action_callback_t callback)
{
    s_callback = callback;

    if (!s_button_queue) {
        s_button_queue = xQueueCreate(8, sizeof(gpio_num_t));
        if (!s_button_queue) {
            return ESP_ERR_NO_MEM;
        }
    } else {
        xQueueReset(s_button_queue);
    }

    esp_err_t err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    ESP_ERROR_CHECK(configure_button(BUTTON_GREEN_GPIO));
    ESP_ERROR_CHECK(configure_button(BUTTON_NEXT_GPIO));
    ESP_ERROR_CHECK(configure_button(BUTTON_PREVIOUS_GPIO));

    if (!s_callback) {
        return ESP_OK;
    }

    BaseType_t task = xTaskCreate(button_task, "button_task", 4096, NULL, 8, NULL);
    return task == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}

bool buttons_wait_for_action(button_action_t *action, uint32_t timeout_ms)
{
    if (!s_button_queue || !action) {
        return false;
    }

    TickType_t timeout_ticks = timeout_ms == portMAX_DELAY ? portMAX_DELAY : pdMS_TO_TICKS(timeout_ms);
    TickType_t started = xTaskGetTickCount();

    while (true) {
        gpio_num_t gpio;
        if (xQueueReceive(s_button_queue, &gpio, timeout_ticks) != pdTRUE) {
            return false;
        }

        if (!action_from_gpio(gpio, action)) {
            continue;
        }

        int index = (int)*action;
        int64_t now = esp_timer_get_time();
        if (now - s_last_press_us[index] >= DEBOUNCE_US) {
            s_last_press_us[index] = now;
            ESP_LOGI(TAG, "Button action %d", *action);
            return true;
        }

        if (timeout_ms == portMAX_DELAY) {
            continue;
        }

        TickType_t elapsed = xTaskGetTickCount() - started;
        if (elapsed >= pdMS_TO_TICKS(timeout_ms)) {
            return false;
        }
        timeout_ticks = pdMS_TO_TICKS(timeout_ms) - elapsed;
    }
}

void buttons_clear_pending(void)
{
    if (!s_button_queue) {
        return;
    }

    gpio_num_t gpio;
    while (xQueueReceive(s_button_queue, &gpio, 0) == pdTRUE) {
    }
}
