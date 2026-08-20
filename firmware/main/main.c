#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "app_config.h"
#include "buttons.h"
#include "buzzer.h"
#include "display_driver.h"
#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "esp_sntp.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_app.h"
#include "nvs_flash.h"
#include "sensors.h"
#include "server_api.h"
#include "wifi_portal.h"

#define BUTTON_GREEN_GPIO GPIO_NUM_3
#define BUTTON_NEXT_GPIO GPIO_NUM_4
#define BUTTON_PREVIOUS_GPIO GPIO_NUM_5
#define DEFAULT_SLEEP_SECONDS 7200
#define MIN_SLEEP_SECONDS 60
#define MAX_SLEEP_SECONDS 86400
#define BUTTON_INTERACTIVE_WINDOW_US (60LL * 1000LL * 1000LL)

static const char *TAG = "eink_main";
static device_config_t s_device_config;
static app_settings_t s_settings;
static SemaphoreHandle_t s_refresh_mutex;

static bool factory_reset_combo_pressed(void)
{
    gpio_config_t config = {
        .pin_bit_mask = (1ULL << BUTTON_GREEN_GPIO) | (1ULL << BUTTON_NEXT_GPIO) | (1ULL << BUTTON_PREVIOUS_GPIO),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&config);
    vTaskDelay(pdMS_TO_TICKS(1500));

    return gpio_get_level(BUTTON_GREEN_GPIO) == 0 &&
           gpio_get_level(BUTTON_NEXT_GPIO) == 0 &&
           gpio_get_level(BUTTON_PREVIOUS_GPIO) == 0;
}

static bool button_action_from_wakeup(button_action_t *action)
{
    if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_EXT1) {
        return false;
    }

    uint64_t gpio_mask = esp_sleep_get_ext1_wakeup_status();
    if (gpio_mask & (1ULL << BUTTON_GREEN_GPIO)) {
        *action = BUTTON_ACTION_CURRENT_MONTH;
        return true;
    }
    if (gpio_mask & (1ULL << BUTTON_NEXT_GPIO)) {
        *action = BUTTON_ACTION_NEXT_MONTH;
        return true;
    }
    if (gpio_mask & (1ULL << BUTTON_PREVIOUS_GPIO)) {
        *action = BUTTON_ACTION_PREVIOUS_MONTH;
        return true;
    }

    return false;
}

static void apply_timezone(const app_settings_t *settings)
{
    const char *timezone = settings->timezone_posix[0] != '\0'
        ? settings->timezone_posix
        : "CET-1CEST,M3.5.0/2,M10.5.0/3";

    setenv("TZ", timezone, 1);
    tzset();
    ESP_LOGI(TAG, "Timezone applied: %s (%s)", settings->timezone, timezone);
}

static void init_time(void)
{
    apply_timezone(&s_settings);

    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    for (int retry = 0; retry < 20; retry++) {
        time_t now = time(NULL);
        struct tm timeinfo;
        localtime_r(&now, &timeinfo);
        if (timeinfo.tm_year >= (2024 - 1900)) {
            ESP_LOGI(TAG, "Time synced");
            return;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    ESP_LOGW(TAG, "SNTP time not synced yet; scheduled refresh will wait");
}

static bool settings_changed(const app_settings_t *a, const app_settings_t *b)
{
    return memcmp(a, b, sizeof(*a)) != 0;
}

static bool starts_with(const char *value, const char *prefix)
{
    return strncmp(value, prefix, strlen(prefix)) == 0;
}

static bool is_loopback_server_url(const char *server_url)
{
    return starts_with(server_url, "http://127.") ||
           starts_with(server_url, "https://127.") ||
           starts_with(server_url, "http://localhost") ||
           starts_with(server_url, "https://localhost") ||
           starts_with(server_url, "http://0.0.0.0") ||
           starts_with(server_url, "https://0.0.0.0") ||
           starts_with(server_url, "http://[::1]") ||
           starts_with(server_url, "https://[::1]");
}

static void apply_server_url_setting(const app_settings_t *settings)
{
    if (settings->server_url[0] == '\0' ||
        strcmp(settings->server_url, s_device_config.server_url) == 0) {
        return;
    }

    if (is_loopback_server_url(settings->server_url)) {
        ESP_LOGW(TAG, "Ignoring unsafe loopback server URL from settings: %s", settings->server_url);
        return;
    }

    esp_err_t health_err = server_api_check_health(settings->server_url, s_device_config.device_token);
    if (health_err != ESP_OK) {
        ESP_LOGW(TAG, "Ignoring server URL %s; health check failed: %s",
                 settings->server_url, esp_err_to_name(health_err));
        return;
    }

    device_config_t next_config = s_device_config;
    strlcpy(next_config.server_url, settings->server_url, sizeof(next_config.server_url));

    esp_err_t err = app_config_save(&next_config);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Server URL update failed: %s", esp_err_to_name(err));
        return;
    }

    s_device_config = next_config;
    ESP_LOGW(TAG, "Server URL updated from settings: %s", s_device_config.server_url);
}

static void apply_server_settings(void)
{
    app_settings_t next_settings;
    app_settings_set_defaults(&next_settings);

    esp_err_t err = server_api_fetch_settings(
        s_device_config.server_url,
        s_device_config.device_token,
        &next_settings
    );
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Using previous settings; fetch failed: %s", esp_err_to_name(err));
        return;
    }

    apply_server_url_setting(&next_settings);

    if (settings_changed(&s_settings, &next_settings)) {
        s_settings = next_settings;
        apply_timezone(&s_settings);
        mqtt_app_apply_settings(&s_settings);
    }
}

static void read_and_send_sensors(void)
{
    sensor_reading_t reading;
    if (sensors_read(&reading) != ESP_OK) {
        ESP_LOGW(TAG, "No sensor data available");
        return;
    }

    server_api_post_sensors(s_device_config.server_url, s_device_config.device_token, &reading);
    mqtt_app_publish_sensors(&s_settings, &reading);
}

static esp_err_t refresh_screen(const char *reason)
{
    if (xSemaphoreTake(s_refresh_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "Refresh skipped; another refresh is running");
        return ESP_ERR_INVALID_STATE;
    }

    ESP_LOGI(TAG, "Refresh start: %s", reason);
    apply_server_settings();
    read_and_send_sensors();

    uint8_t *bmp = NULL;
    size_t bmp_len = 0;
    esp_err_t err = server_api_download_screen_bmp(
        s_device_config.server_url,
        s_device_config.device_token,
        &bmp,
        &bmp_len
    );
    if (err == ESP_OK) {
        err = display_driver_show_bmp(bmp, bmp_len);
        free(bmp);
    }

    if (err == ESP_OK) {
        display_driver_sleep();
        ESP_LOGI(TAG, "Refresh complete");
    } else {
        ESP_LOGE(TAG, "Refresh failed: %s", esp_err_to_name(err));
    }

    xSemaphoreGive(s_refresh_mutex);
    return err;
}

static esp_err_t handle_button_action(button_action_t action)
{
    screen_action_t screen_action = SCREEN_ACTION_CURRENT;

    if (action == BUTTON_ACTION_PREVIOUS_MONTH) {
        buzzer_beep(2100, 35);
        screen_action = SCREEN_ACTION_PREVIOUS;
    } else if (action == BUTTON_ACTION_NEXT_MONTH) {
        buzzer_beep(2500, 35);
        screen_action = SCREEN_ACTION_NEXT;
    } else {
        buzzer_beep(1800, 35);
        vTaskDelay(pdMS_TO_TICKS(20));
        buzzer_beep(2500, 35);
    }

    esp_err_t err = server_api_post_screen_action(
        s_device_config.server_url,
        s_device_config.device_token,
        screen_action
    );
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Button action failed: %s", esp_err_to_name(err));
    } else {
        err = refresh_screen("button");
    }

    return err;
}

static uint64_t seconds_until_next_refresh(const app_settings_t *settings)
{
    apply_timezone(settings);

    time_t now = time(NULL);
    struct tm timeinfo;
    localtime_r(&now, &timeinfo);

    if (timeinfo.tm_year < (2024 - 1900)) {
        return DEFAULT_SLEEP_SECONDS;
    }

    time_t best = 0;
    for (size_t i = 0; i < settings->refresh_hour_count; i++) {
        int hour = -1;
        int minute = -1;
        if (sscanf(settings->refresh_hours[i], "%d:%d", &hour, &minute) != 2 ||
            hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            continue;
        }

        struct tm candidate_tm = timeinfo;
        candidate_tm.tm_hour = hour;
        candidate_tm.tm_min = minute;
        candidate_tm.tm_sec = 0;

        time_t candidate = mktime(&candidate_tm);
        if (candidate <= now + MIN_SLEEP_SECONDS) {
            candidate += 24 * 60 * 60;
        }

        if (best == 0 || candidate < best) {
            best = candidate;
        }
    }

    if (best == 0) {
        return DEFAULT_SLEEP_SECONDS;
    }

    double seconds = difftime(best, now);
    if (seconds < MIN_SLEEP_SECONDS) {
        return MIN_SLEEP_SECONDS;
    }
    if (seconds > MAX_SLEEP_SECONDS) {
        return MAX_SLEEP_SECONDS;
    }

    return (uint64_t)seconds;
}

static bool any_button_pressed(void)
{
    return gpio_get_level(BUTTON_GREEN_GPIO) == 0 ||
           gpio_get_level(BUTTON_NEXT_GPIO) == 0 ||
           gpio_get_level(BUTTON_PREVIOUS_GPIO) == 0;
}

static void wait_for_buttons_released(void)
{
    for (int retry = 0; retry < 100 && any_button_pressed(); retry++) {
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

static void run_button_interactive_window(void)
{
    int64_t not_before_us = esp_timer_get_time() + BUTTON_INTERACTIVE_WINDOW_US;
    ESP_LOGI(TAG, "Button interactive window open for 60 seconds");

    while (true) {
        const int64_t remaining_us = not_before_us - esp_timer_get_time();
        if (remaining_us <= 0) {
            ESP_LOGI(TAG, "Button interactive window closed");
            return;
        }

        const uint32_t remaining_ms = (uint32_t)((remaining_us + 999LL) / 1000LL);
        button_action_t action;
        if (!buttons_wait_for_action(&action, remaining_ms)) {
            ESP_LOGI(TAG, "Button interactive window closed");
            return;
        }

        handle_button_action(action);
        wait_for_buttons_released();
        not_before_us = esp_timer_get_time() + BUTTON_INTERACTIVE_WINDOW_US;
        ESP_LOGI(TAG, "Button interactive window restarted for 60 seconds");
    }
}

static esp_err_t configure_rtc_wakeup_button(gpio_num_t gpio)
{
    ESP_ERROR_CHECK(rtc_gpio_init(gpio));
    ESP_ERROR_CHECK(rtc_gpio_set_direction(gpio, RTC_GPIO_MODE_INPUT_ONLY));
    ESP_ERROR_CHECK(rtc_gpio_pullup_en(gpio));
    ESP_ERROR_CHECK(rtc_gpio_pulldown_dis(gpio));
    return ESP_OK;
}

static void enter_sleep_until_next_refresh(void)
{
    const uint64_t sleep_seconds = seconds_until_next_refresh(&s_settings);
    const uint64_t button_mask =
        (1ULL << BUTTON_GREEN_GPIO) |
        (1ULL << BUTTON_NEXT_GPIO) |
        (1ULL << BUTTON_PREVIOUS_GPIO);

    wait_for_buttons_released();
    buttons_clear_pending();

    ESP_ERROR_CHECK(esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL));
    ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(sleep_seconds * 1000000ULL));
    ESP_ERROR_CHECK(configure_rtc_wakeup_button(BUTTON_GREEN_GPIO));
    ESP_ERROR_CHECK(configure_rtc_wakeup_button(BUTTON_NEXT_GPIO));
    ESP_ERROR_CHECK(configure_rtc_wakeup_button(BUTTON_PREVIOUS_GPIO));
    ESP_ERROR_CHECK(esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON));
    ESP_ERROR_CHECK(esp_sleep_enable_ext1_wakeup(button_mask, ESP_EXT1_WAKEUP_ANY_LOW));

    mqtt_app_stop();
    esp_wifi_stop();
    display_driver_sleep();

    ESP_LOGI(TAG, "Entering deep sleep for %llu seconds or until any button is pressed",
             (unsigned long long)sleep_seconds);
    esp_deep_sleep_start();
}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    app_settings_set_defaults(&s_settings);
    ESP_ERROR_CHECK(app_config_load(&s_device_config));

    button_action_t wake_button_action;
    bool has_wake_button_action = button_action_from_wakeup(&wake_button_action);

    if (factory_reset_combo_pressed()) {
        ESP_LOGW(TAG, "Factory reset combo detected; clearing WiFi/server config");
        ESP_ERROR_CHECK(app_config_reset());
        memset(&s_device_config, 0, sizeof(s_device_config));
        has_wake_button_action = false;
    }

    ESP_ERROR_CHECK(display_driver_init());
    ESP_ERROR_CHECK(wifi_portal_init());
    ESP_ERROR_CHECK(wifi_portal_connect_or_configure(&s_device_config));

    init_time();
    ESP_ERROR_CHECK(sensors_init());
    err = buzzer_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Buzzer disabled: %s", esp_err_to_name(err));
    }

    s_refresh_mutex = xSemaphoreCreateMutex();
    ESP_ERROR_CHECK(s_refresh_mutex ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(buttons_init(NULL));

    apply_server_settings();
    if (has_wake_button_action) {
        wait_for_buttons_released();
        buttons_clear_pending();
        handle_button_action(wake_button_action);
        wait_for_buttons_released();
        run_button_interactive_window();
    } else {
        const esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
        refresh_screen(cause == ESP_SLEEP_WAKEUP_TIMER ? "schedule" : "boot");
    }

    enter_sleep_until_next_refresh();
}
