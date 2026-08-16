#include "app_config.h"

#include <string.h>
#include "nvs.h"
#include "nvs_flash.h"

#define NVS_NAMESPACE "eink_cfg"
#define KEY_WIFI_SSID "wifi_ssid"
#define KEY_WIFI_PASS "wifi_pass"
#define KEY_SERVER_URL "server_url"
#define KEY_DEVICE_TOKEN "dev_token"

static esp_err_t nvs_read_string(nvs_handle_t handle, const char *key, char *target, size_t target_len)
{
    size_t required = target_len;
    esp_err_t err = nvs_get_str(handle, key, target, &required);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        target[0] = '\0';
        return ESP_OK;
    }
    return err;
}

esp_err_t app_config_load(device_config_t *config)
{
    memset(config, 0, sizeof(*config));

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_read_string(handle, KEY_WIFI_SSID, config->wifi_ssid, sizeof(config->wifi_ssid));
    if (err == ESP_OK) {
        err = nvs_read_string(handle, KEY_WIFI_PASS, config->wifi_password, sizeof(config->wifi_password));
    }
    if (err == ESP_OK) {
        err = nvs_read_string(handle, KEY_SERVER_URL, config->server_url, sizeof(config->server_url));
    }
    if (err == ESP_OK) {
        err = nvs_read_string(handle, KEY_DEVICE_TOKEN, config->device_token, sizeof(config->device_token));
    }

    nvs_close(handle);
    return err;
}

esp_err_t app_config_save(const device_config_t *config)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    if ((err = nvs_set_str(handle, KEY_WIFI_SSID, config->wifi_ssid)) != ESP_OK ||
        (err = nvs_set_str(handle, KEY_WIFI_PASS, config->wifi_password)) != ESP_OK ||
        (err = nvs_set_str(handle, KEY_SERVER_URL, config->server_url)) != ESP_OK ||
        (err = nvs_set_str(handle, KEY_DEVICE_TOKEN, config->device_token)) != ESP_OK ||
        (err = nvs_commit(handle)) != ESP_OK) {
        nvs_close(handle);
        return err;
    }

    nvs_close(handle);
    return ESP_OK;
}

esp_err_t app_config_reset(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_erase_all(handle);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return err;
}

bool app_config_is_complete(const device_config_t *config)
{
    return config->wifi_ssid[0] != '\0' && config->server_url[0] != '\0';
}

void app_settings_set_defaults(app_settings_t *settings)
{
    memset(settings, 0, sizeof(*settings));
    strlcpy(settings->device_id, "seeed-e1002", sizeof(settings->device_id));
    strlcpy(settings->timezone, "Europe/Madrid", sizeof(settings->timezone));
    strlcpy(settings->timezone_posix, "CET-1CEST,M3.5.0/2,M10.5.0/3", sizeof(settings->timezone_posix));
    strlcpy(settings->refresh_hours[0], "07:00", sizeof(settings->refresh_hours[0]));
    strlcpy(settings->refresh_hours[1], "12:00", sizeof(settings->refresh_hours[1]));
    strlcpy(settings->refresh_hours[2], "18:00", sizeof(settings->refresh_hours[2]));
    settings->refresh_hour_count = 3;
    strlcpy(settings->mqtt_host, "mqtt.local", sizeof(settings->mqtt_host));
    settings->mqtt_port = 1883;
    strlcpy(settings->mqtt_base_topic, "home/eink/e1002", sizeof(settings->mqtt_base_topic));
}
