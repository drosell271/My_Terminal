#include "server_api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"

#define SETTINGS_MAX_BYTES 8192
#define BMP_MAX_BYTES (2 * 1024 * 1024)
#define HTTP_TIMEOUT_MS 30000

static const char *TAG = "server_api";

typedef struct {
    uint8_t *data;
    size_t len;
    size_t max_len;
} response_buffer_t;

static void build_url(const char *server_url, const char *path, char *target, size_t target_len)
{
    size_t base_len = strlen(server_url);
    while (base_len > 0 && server_url[base_len - 1] == '/') {
        base_len--;
    }

    snprintf(target, target_len, "%.*s%s", (int)base_len, server_url, path);
}

static void set_device_token_header(esp_http_client_handle_t client, const char *device_token)
{
    if (device_token && device_token[0] != '\0') {
        esp_http_client_set_header(client, "X-Device-Token", device_token);
    }
}

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    response_buffer_t *buffer = (response_buffer_t *)evt->user_data;

    if (evt->event_id == HTTP_EVENT_ON_DATA && evt->data_len > 0) {
        if (buffer->len + evt->data_len > buffer->max_len) {
            ESP_LOGE(TAG, "HTTP response too large: %u bytes", (unsigned)(buffer->len + evt->data_len));
            return ESP_ERR_NO_MEM;
        }

        memcpy(buffer->data + buffer->len, evt->data, evt->data_len);
        buffer->len += evt->data_len;
    }

    return ESP_OK;
}

static uint8_t *alloc_http_buffer(size_t max_len)
{
    uint8_t *buffer = heap_caps_malloc(max_len + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!buffer) {
        buffer = heap_caps_malloc(max_len + 1, MALLOC_CAP_8BIT);
    }
    return buffer;
}

static esp_err_t http_get_buffer(const char *url, const char *device_token, size_t max_len, uint8_t **data, size_t *len)
{
    response_buffer_t response = {
        .data = alloc_http_buffer(max_len),
        .len = 0,
        .max_len = max_len,
    };
    if (!response.data) {
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_config_t config = {
        .url = url,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .event_handler = http_event_handler,
        .user_data = &response,
        .buffer_size = 2048,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        free(response.data);
        return ESP_FAIL;
    }
    set_device_token_header(client, device_token);

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status < 200 || status >= 300) {
        ESP_LOGE(TAG, "GET %s failed: err=%s status=%d", url, esp_err_to_name(err), status);
        free(response.data);
        return err == ESP_OK ? ESP_FAIL : err;
    }

    response.data[response.len] = '\0';
    *data = response.data;
    *len = response.len;
    return ESP_OK;
}

static esp_err_t http_post_json(const char *url, const char *device_token, const char *body)
{
    response_buffer_t response = {
        .data = alloc_http_buffer(2048),
        .len = 0,
        .max_len = 2048,
    };
    if (!response.data) {
        return ESP_ERR_NO_MEM;
    }

    esp_http_client_config_t config = {
        .url = url,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .event_handler = http_event_handler,
        .user_data = &response,
        .buffer_size = 1024,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        free(response.data);
        return ESP_FAIL;
    }

    set_device_token_header(client, device_token);
    esp_http_client_set_method(client, HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    free(response.data);

    if (err != ESP_OK || status < 200 || status >= 300) {
        ESP_LOGE(TAG, "POST %s failed: err=%s status=%d", url, esp_err_to_name(err), status);
        return err == ESP_OK ? ESP_FAIL : err;
    }

    return ESP_OK;
}

static const char *json_string(cJSON *object, const char *key)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsString(item) ? item->valuestring : "";
}

static int json_int(cJSON *object, const char *key, int fallback)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsNumber(item) ? item->valueint : fallback;
}

static void copy_json_string_if_present(cJSON *object, const char *key, char *target, size_t target_len)
{
    const char *value = json_string(object, key);
    if (value[0] != '\0') {
        strlcpy(target, value, target_len);
    }
}

esp_err_t server_api_check_health(const char *server_url, const char *device_token)
{
    char url[SERVER_URL_MAX_LEN + 32];
    build_url(server_url, "/api/device/settings", url, sizeof(url));

    uint8_t *body = NULL;
    size_t body_len = 0;
    esp_err_t err = http_get_buffer(url, device_token, 2048, &body, &body_len);
    free(body);
    return err;
}

esp_err_t server_api_fetch_settings(const char *server_url, const char *device_token, app_settings_t *settings)
{
    char url[SERVER_URL_MAX_LEN + 32];
    build_url(server_url, "/api/device/settings", url, sizeof(url));

    uint8_t *body = NULL;
    size_t body_len = 0;
    ESP_RETURN_ON_ERROR(http_get_buffer(url, device_token, SETTINGS_MAX_BYTES, &body, &body_len), TAG, "fetch settings");

    cJSON *root = cJSON_ParseWithLength((const char *)body, body_len);
    free(body);
    if (!root) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    app_settings_set_defaults(settings);
    copy_json_string_if_present(root, "deviceId", settings->device_id, sizeof(settings->device_id));
    copy_json_string_if_present(root, "serverUrl", settings->server_url, sizeof(settings->server_url));
    copy_json_string_if_present(root, "timezone", settings->timezone, sizeof(settings->timezone));
    copy_json_string_if_present(root, "timezonePosix", settings->timezone_posix, sizeof(settings->timezone_posix));
    copy_json_string_if_present(root, "mqttHost", settings->mqtt_host, sizeof(settings->mqtt_host));
    settings->mqtt_port = json_int(root, "mqttPort", 1883);
    copy_json_string_if_present(root, "mqttUsername", settings->mqtt_username, sizeof(settings->mqtt_username));
    copy_json_string_if_present(root, "mqttPassword", settings->mqtt_password, sizeof(settings->mqtt_password));
    copy_json_string_if_present(root, "mqttBaseTopic", settings->mqtt_base_topic, sizeof(settings->mqtt_base_topic));

    cJSON *hours = cJSON_GetObjectItemCaseSensitive(root, "refreshHours");
    if (cJSON_IsArray(hours)) {
        settings->refresh_hour_count = 0;
        cJSON *hour = NULL;
        cJSON_ArrayForEach(hour, hours) {
            if (settings->refresh_hour_count >= REFRESH_HOUR_MAX_COUNT) {
                break;
            }
            if (cJSON_IsString(hour) && strlen(hour->valuestring) == 5) {
                strlcpy(
                    settings->refresh_hours[settings->refresh_hour_count],
                    hour->valuestring,
                    sizeof(settings->refresh_hours[settings->refresh_hour_count])
                );
                settings->refresh_hour_count++;
            }
        }
    }

    cJSON_Delete(root);
    ESP_LOGI(TAG, "Settings loaded: %u refresh hours, timezone %s, MQTT %s:%d",
             (unsigned)settings->refresh_hour_count,
             settings->timezone,
             settings->mqtt_host,
             settings->mqtt_port);
    return ESP_OK;
}

esp_err_t server_api_download_screen_bmp(const char *server_url, const char *device_token, uint8_t **bmp, size_t *bmp_len)
{
    char url[SERVER_URL_MAX_LEN + 32];
    build_url(server_url, "/api/screen.bmp", url, sizeof(url));
    return http_get_buffer(url, device_token, BMP_MAX_BYTES, bmp, bmp_len);
}

static void json_number_or_null(char *target, size_t target_len, bool has_value, float value)
{
    if (!has_value) {
        strlcpy(target, "null", target_len);
        return;
    }
    snprintf(target, target_len, "%.2f", value);
}

esp_err_t server_api_post_sensors(const char *server_url, const char *device_token, const sensor_reading_t *reading)
{
    char url[SERVER_URL_MAX_LEN + 32];
    char battery[16];
    char temp[16];
    char humidity[16];
    char rssi[16];
    char body[256];

    build_url(server_url, "/api/device/sensors", url, sizeof(url));
    json_number_or_null(battery, sizeof(battery), reading->has_battery, reading->battery_percent);
    json_number_or_null(temp, sizeof(temp), reading->has_temperature, reading->temperature_c);
    json_number_or_null(humidity, sizeof(humidity), reading->has_humidity, reading->humidity_percent);

    if (reading->has_rssi) {
        snprintf(rssi, sizeof(rssi), "%d", reading->rssi);
    } else {
        strlcpy(rssi, "null", sizeof(rssi));
    }

    snprintf(
        body,
        sizeof(body),
        "{\"batteryPercent\":%s,\"temperatureC\":%s,\"humidityPercent\":%s,\"rssi\":%s}",
        battery,
        temp,
        humidity,
        rssi
    );

    return http_post_json(url, device_token, body);
}

esp_err_t server_api_post_screen_action(const char *server_url, const char *device_token, screen_action_t action)
{
    const char *path = "/api/screen/month/current";
    if (action == SCREEN_ACTION_PREVIOUS) {
        path = "/api/screen/month/previous";
    } else if (action == SCREEN_ACTION_NEXT) {
        path = "/api/screen/month/next";
    }

    char url[SERVER_URL_MAX_LEN + 40];
    build_url(server_url, path, url, sizeof(url));
    return http_post_json(url, device_token, "{}");
}
