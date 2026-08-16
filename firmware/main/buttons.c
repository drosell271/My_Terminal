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
    int64_t last_press_us[3] = {0};

    while (true) {
        gpio_num_t gpio;
        if (xQueueReceive(s_button_queue, &gpio, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        button_action_t action;
        if (!action_from_gpio(gpio, &action)) {
            continue;
        }

        int index = (int)action;
        int64_t now = esp_timer_get_time();
        if (now - last_press_us[index] < DEBOUNCE_US) {
            continue;
        }
        last_press_us[index] = now;

        ESP_LOGI(TAG, "Button action %d", action);
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
    s_button_queue = xQueueCreate(8, sizeof(gpio_num_t));
    if (!s_button_queue) {
        return ESP_ERR_NO_MEM;
    }

    esp_err_t err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    ESP_ERROR_CHECK(configure_button(BUTTON_GREEN_GPIO));
    ESP_ERROR_CHECK(configure_button(BUTTON_NEXT_GPIO));
    ESP_ERROR_CHECK(configure_button(BUTTON_PREVIOUS_GPIO));

    BaseType_t task = xTaskCreate(button_task, "button_task", 4096, NULL, 8, NULL);
    return task == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}
