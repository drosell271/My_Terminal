#pragma once

#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#define WIFI_SSID_MAX_LEN 32
#define WIFI_PASSWORD_MAX_LEN 64
#define SERVER_URL_MAX_LEN 128
#define DEVICE_TOKEN_MAX_LEN 128
#define DEVICE_ID_MAX_LEN 64
#define TIMEZONE_MAX_LEN 64
#define TIMEZONE_POSIX_MAX_LEN 64
#define REFRESH_HOUR_MAX_COUNT 12
#define MQTT_HOST_MAX_LEN 128
#define MQTT_USERNAME_MAX_LEN 128
#define MQTT_PASSWORD_MAX_LEN 128
#define MQTT_TOPIC_MAX_LEN 128

typedef struct {
    char wifi_ssid[WIFI_SSID_MAX_LEN + 1];
    char wifi_password[WIFI_PASSWORD_MAX_LEN + 1];
    char server_url[SERVER_URL_MAX_LEN + 1];
    char device_token[DEVICE_TOKEN_MAX_LEN + 1];
} device_config_t;

typedef struct {
    char device_id[DEVICE_ID_MAX_LEN + 1];
    char server_url[SERVER_URL_MAX_LEN + 1];
    char timezone[TIMEZONE_MAX_LEN + 1];
    char timezone_posix[TIMEZONE_POSIX_MAX_LEN + 1];
    char refresh_hours[REFRESH_HOUR_MAX_COUNT][6];
    size_t refresh_hour_count;
    char mqtt_host[MQTT_HOST_MAX_LEN + 1];
    int mqtt_port;
    char mqtt_username[MQTT_USERNAME_MAX_LEN + 1];
    char mqtt_password[MQTT_PASSWORD_MAX_LEN + 1];
    char mqtt_base_topic[MQTT_TOPIC_MAX_LEN + 1];
} app_settings_t;

esp_err_t app_config_load(device_config_t *config);
esp_err_t app_config_save(const device_config_t *config);
esp_err_t app_config_reset(void);
bool app_config_is_complete(const device_config_t *config);

void app_settings_set_defaults(app_settings_t *settings);
