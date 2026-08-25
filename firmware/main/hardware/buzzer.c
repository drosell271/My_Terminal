#include "buzzer.h"

#include <stdbool.h>
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define BUZZER_GPIO GPIO_NUM_45
#define BUZZER_LEDC_MODE LEDC_LOW_SPEED_MODE
#define BUZZER_LEDC_TIMER LEDC_TIMER_0
#define BUZZER_LEDC_CHANNEL LEDC_CHANNEL_0
#define BUZZER_DUTY_RESOLUTION LEDC_TIMER_10_BIT
#define BUZZER_DUTY_OFF 0
#define BUZZER_DUTY_ON 512

static const char *TAG = "buzzer";
static bool s_ready;

esp_err_t buzzer_init(void)
{
    ledc_timer_config_t timer = {
        .speed_mode = BUZZER_LEDC_MODE,
        .timer_num = BUZZER_LEDC_TIMER,
        .duty_resolution = BUZZER_DUTY_RESOLUTION,
        .freq_hz = 2200,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&timer), TAG, "configure buzzer timer");

    ledc_channel_config_t channel = {
        .gpio_num = BUZZER_GPIO,
        .speed_mode = BUZZER_LEDC_MODE,
        .channel = BUZZER_LEDC_CHANNEL,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = BUZZER_LEDC_TIMER,
        .duty = BUZZER_DUTY_OFF,
        .hpoint = 0,
    };
    ESP_RETURN_ON_ERROR(ledc_channel_config(&channel), TAG, "configure buzzer channel");

    s_ready = true;
    return ESP_OK;
}

esp_err_t buzzer_beep(uint32_t frequency_hz, uint32_t duration_ms)
{
    if (!s_ready) {
        return ESP_OK;
    }

    if (frequency_hz == 0) {
        frequency_hz = 2200;
    }
    if (duration_ms == 0) {
        duration_ms = 30;
    }

    ESP_RETURN_ON_ERROR(
        ledc_set_freq(BUZZER_LEDC_MODE, BUZZER_LEDC_TIMER, frequency_hz),
        TAG,
        "set buzzer frequency"
    );
    ESP_RETURN_ON_ERROR(
        ledc_set_duty(BUZZER_LEDC_MODE, BUZZER_LEDC_CHANNEL, BUZZER_DUTY_ON),
        TAG,
        "set buzzer duty"
    );
    ESP_RETURN_ON_ERROR(
        ledc_update_duty(BUZZER_LEDC_MODE, BUZZER_LEDC_CHANNEL),
        TAG,
        "start buzzer"
    );

    vTaskDelay(pdMS_TO_TICKS(duration_ms));

    ESP_RETURN_ON_ERROR(
        ledc_set_duty(BUZZER_LEDC_MODE, BUZZER_LEDC_CHANNEL, BUZZER_DUTY_OFF),
        TAG,
        "clear buzzer duty"
    );
    return ledc_update_duty(BUZZER_LEDC_MODE, BUZZER_LEDC_CHANNEL);
}
