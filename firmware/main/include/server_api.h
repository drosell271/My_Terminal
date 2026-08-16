#pragma once

#include <stddef.h>
#include <stdint.h>
#include "app_config.h"
#include "esp_err.h"
#include "sensors.h"

typedef enum {
    SCREEN_ACTION_PREVIOUS,
    SCREEN_ACTION_NEXT,
    SCREEN_ACTION_CURRENT,
} screen_action_t;

esp_err_t server_api_check_health(const char *server_url, const char *device_token);
esp_err_t server_api_fetch_settings(const char *server_url, const char *device_token, app_settings_t *settings);
esp_err_t server_api_download_screen_bmp(const char *server_url, const char *device_token, uint8_t **bmp, size_t *bmp_len);
esp_err_t server_api_post_sensors(const char *server_url, const char *device_token, const sensor_reading_t *reading);
esp_err_t server_api_post_screen_action(const char *server_url, const char *device_token, screen_action_t action);
