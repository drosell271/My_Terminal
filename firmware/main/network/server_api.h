#pragma once

#include <stdbool.h>
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

typedef struct {
    bool update_available;
    char latest_version[65];
    char url[193];
    char sha256[65];
    size_t size;
    bool mandatory;
} firmware_manifest_t;

esp_err_t server_api_check_health(const char *server_url, const char *device_token);
esp_err_t server_api_fetch_settings(const char *server_url, const char *device_token, app_settings_t *settings);
esp_err_t server_api_download_screen_bmp(const char *server_url, const char *device_token, uint8_t **bmp, size_t *bmp_len);
esp_err_t server_api_post_sensors(const char *server_url, const char *device_token, const sensor_reading_t *reading);
esp_err_t server_api_post_screen_action(const char *server_url, const char *device_token, screen_action_t action);
esp_err_t server_api_post_device_status(
    const char *server_url,
    const char *device_token,
    const char *firmware_version,
    const char *screen_refresh_status,
    const char *refresh_reason,
    const char *last_error,
    const char *ota_status,
    const char *ota_version
);
esp_err_t server_api_fetch_firmware_manifest(
    const char *server_url,
    const char *device_token,
    const char *current_version,
    firmware_manifest_t *manifest
);
esp_err_t server_api_perform_ota_update(
    const char *server_url,
    const char *device_token,
    const firmware_manifest_t *manifest
);
