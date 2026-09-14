#include "server_api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "mbedtls/sha256.h"

#define SETTINGS_MAX_BYTES 8192
#define BMP_MAX_BYTES (2 * 1024 * 1024)
#define HTTP_TIMEOUT_MS 30000

static const char *TAG = "server_api";

typedef struct {
    uint8_t *data;
    size_t len;
    size_t max_len;
} response_buffer_t;

typedef struct {
    esp_ota_handle_t handle;
    mbedtls_sha256_context sha256;
    size_t bytes_written;
    bool failed;
} ota_download_context_t;

static void build_url(const char *server_url, const char *path, char *target, size_t target_len)
{
    size_t base_len = strlen(server_url);
    while (base_len > 0 && server_url[base_len - 1] == '/') {
        base_len--;
    }

    snprintf(target, target_len, "%.*s%s", (int)base_len, server_url, path);
}

static bool starts_with(const char *value, const char *prefix)
{
    return strncmp(value, prefix, strlen(prefix)) == 0;
}

static void resolve_url(const char *server_url, const char *value, char *target, size_t target_len)
{
    if (starts_with(value, "http://") || starts_with(value, "https://")) {
        strlcpy(target, value, target_len);
        return;
    }

    if (value[0] == '/') {
        build_url(server_url, value, target, target_len);
    } else {
        char path[200];
        snprintf(path, sizeof(path), "/%s", value);
        build_url(server_url, path, target, target_len);
    }
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

static esp_err_t ota_http_event_handler(esp_http_client_event_t *evt)
{
    ota_download_context_t *context = (ota_download_context_t *)evt->user_data;

    if (evt->event_id == HTTP_EVENT_ON_DATA && evt->data_len > 0) {
        esp_err_t err = esp_ota_write(context->handle, evt->data, evt->data_len);
        if (err != ESP_OK) {
            context->failed = true;
            ESP_LOGE(TAG, "OTA write failed: %s", esp_err_to_name(err));
            return err;
        }

        if (mbedtls_sha256_update(
                &context->sha256,
                (const unsigned char *)evt->data,
                (size_t)evt->data_len
            ) != 0) {
            context->failed = true;
            return ESP_FAIL;
        }
        context->bytes_written += (size_t)evt->data_len;
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

static size_t json_size(cJSON *object, const char *key)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsNumber(item) && item->valuedouble > 0 ? (size_t)item->valuedouble : 0;
}

static bool json_bool(cJSON *object, const char *key)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    return cJSON_IsTrue(item);
}

static void copy_json_string_if_present(cJSON *object, const char *key, char *target, size_t target_len)
{
    const char *value = json_string(object, key);
    if (value[0] != '\0') {
        strlcpy(target, value, target_len);
    }
}

static int hex_value(char c)
{
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return 10 + c - 'a';
    }
    if (c >= 'A' && c <= 'F') {
        return 10 + c - 'A';
    }
    return -1;
}

static bool parse_sha256_hex(const char *hex, uint8_t *target)
{
    if (!hex || strlen(hex) != 64) {
        return false;
    }

    for (int i = 0; i < 32; i++) {
        int high = hex_value(hex[i * 2]);
        int low = hex_value(hex[i * 2 + 1]);
        if (high < 0 || low < 0) {
            return false;
        }
        target[i] = (uint8_t)((high << 4) | low);
    }

    return true;
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

static void json_number_or_null(char *target, size_t target_len, bool has_value, float value, int decimals)
{
    if (!has_value) {
        strlcpy(target, "null", target_len);
        return;
    }
    snprintf(target, target_len, "%.*f", decimals, value);
}

esp_err_t server_api_post_sensors(
    const char *server_url,
    const char *device_token,
    const sensor_reading_t *reading,
    const char *timestamp
)
{
    char url[SERVER_URL_MAX_LEN + 32];
    char battery[16];
    char temp[16];
    char humidity[16];
    char rssi[16];
    char mac_str[32];
    char body[384];

    build_url(server_url, "/api/device/sensors", url, sizeof(url));
    json_number_or_null(battery, sizeof(battery), reading->has_battery, reading->battery_percent, 2);
    json_number_or_null(temp, sizeof(temp), reading->has_temperature, reading->temperature_c, 1);
    json_number_or_null(humidity, sizeof(humidity), reading->has_humidity, reading->humidity_percent, 1);

    if (reading->has_rssi) {
        snprintf(rssi, sizeof(rssi), "%d", reading->rssi);
    } else {
        strlcpy(rssi, "null", sizeof(rssi));
    }

    if (reading->has_mac && reading->mac[0] != '\0') {
        snprintf(mac_str, sizeof(mac_str), "\"%s\"", reading->mac);
    } else {
        strlcpy(mac_str, "null", sizeof(mac_str));
    }

    if (timestamp && timestamp[0] != '\0') {
        snprintf(
            body,
            sizeof(body),
            "{\"batteryPercent\":%s,\"temperatureC\":%s,\"humidityPercent\":%s,\"rssi\":%s,\"mac\":%s,\"updatedAt\":\"%s\"}",
            battery,
            temp,
            humidity,
            rssi,
            mac_str,
            timestamp
        );
    } else {
        snprintf(
            body,
            sizeof(body),
            "{\"batteryPercent\":%s,\"temperatureC\":%s,\"humidityPercent\":%s,\"rssi\":%s,\"mac\":%s}",
            battery,
            temp,
            humidity,
            rssi,
            mac_str
        );
    }

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

esp_err_t server_api_post_device_status(
    const char *server_url,
    const char *device_token,
    const char *firmware_version,
    const char *screen_refresh_status,
    const char *refresh_reason,
    const char *last_error,
    const char *ota_status,
    const char *ota_version,
    const char *timestamp
)
{
    char url[SERVER_URL_MAX_LEN + 32];
    char body[640];

    build_url(server_url, "/api/device/status", url, sizeof(url));
    snprintf(
        body,
        sizeof(body),
        "{\"firmwareVersion\":\"%s\",\"screenRefreshStatus\":\"%s\","
        "\"refreshReason\":\"%s\",\"lastError\":\"%s\",\"otaStatus\":\"%s\","
        "\"otaVersion\":\"%s\"%s%s%s}",
        firmware_version ? firmware_version : "",
        screen_refresh_status ? screen_refresh_status : "",
        refresh_reason ? refresh_reason : "",
        last_error ? last_error : "",
        ota_status ? ota_status : "",
        ota_version ? ota_version : "",
        (timestamp && timestamp[0] != '\0') ? ",\"lastScreenRefreshAt\":\"" : "",
        (timestamp && timestamp[0] != '\0') ? timestamp : "",
        (timestamp && timestamp[0] != '\0') ? "\"" : ""
    );

    return http_post_json(url, device_token, body);
}

esp_err_t server_api_fetch_firmware_manifest(
    const char *server_url,
    const char *device_token,
    const char *current_version,
    firmware_manifest_t *manifest
)
{
    if (!manifest) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(manifest, 0, sizeof(*manifest));

    char path[128];
    char url[SERVER_URL_MAX_LEN + sizeof(path)];
    snprintf(path, sizeof(path), "/api/device/firmware?version=%s", current_version ? current_version : "");
    build_url(server_url, path, url, sizeof(url));

    uint8_t *body = NULL;
    size_t body_len = 0;
    ESP_RETURN_ON_ERROR(http_get_buffer(url, device_token, SETTINGS_MAX_BYTES, &body, &body_len), TAG, "fetch firmware manifest");

    cJSON *root = cJSON_ParseWithLength((const char *)body, body_len);
    free(body);
    if (!root) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    manifest->update_available = json_bool(root, "updateAvailable");
    copy_json_string_if_present(root, "latestVersion", manifest->latest_version, sizeof(manifest->latest_version));
    copy_json_string_if_present(root, "url", manifest->url, sizeof(manifest->url));
    copy_json_string_if_present(root, "sha256", manifest->sha256, sizeof(manifest->sha256));
    manifest->size = json_size(root, "size");
    manifest->mandatory = json_bool(root, "mandatory");
    cJSON_Delete(root);

    if (manifest->update_available && (manifest->url[0] == '\0' || !parse_sha256_hex(manifest->sha256, (uint8_t[32]){0}))) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    ESP_LOGI(TAG, "Firmware manifest: update=%d latest=%s size=%u",
             manifest->update_available,
             manifest->latest_version,
             (unsigned)manifest->size);
    return ESP_OK;
}

esp_err_t server_api_perform_ota_update(
    const char *server_url,
    const char *device_token,
    const firmware_manifest_t *manifest
)
{
    if (!manifest || !manifest->update_available) {
        return ESP_OK;
    }

    uint8_t expected_sha[32];
    if (!parse_sha256_hex(manifest->sha256, expected_sha)) {
        return ESP_ERR_INVALID_ARG;
    }

    const esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
    if (!partition) {
        ESP_LOGE(TAG, "No OTA partition available");
        return ESP_ERR_NOT_FOUND;
    }

    if (manifest->size > 0 && manifest->size > partition->size) {
        ESP_LOGE(TAG, "Firmware image too large: %u > %u",
                 (unsigned)manifest->size, (unsigned)partition->size);
        return ESP_ERR_INVALID_SIZE;
    }

    ota_download_context_t context = {0};
    esp_err_t err = esp_ota_begin(partition, OTA_SIZE_UNKNOWN, &context.handle);
    if (err != ESP_OK) {
        return err;
    }

    mbedtls_sha256_init(&context.sha256);
    if (mbedtls_sha256_starts(&context.sha256, 0) != 0) {
        esp_ota_abort(context.handle);
        mbedtls_sha256_free(&context.sha256);
        return ESP_FAIL;
    }

    char url[256];
    resolve_url(server_url, manifest->url, url, sizeof(url));
    ESP_LOGW(TAG, "Starting OTA update to %s from %s", manifest->latest_version, url);

    esp_http_client_config_t config = {
        .url = url,
        .timeout_ms = 60000,
        .event_handler = ota_http_event_handler,
        .user_data = &context,
        .buffer_size = 4096,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        esp_ota_abort(context.handle);
        mbedtls_sha256_free(&context.sha256);
        return ESP_FAIL;
    }

    set_device_token_header(client, device_token);
    err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    uint8_t actual_sha[32];
    if (mbedtls_sha256_finish(&context.sha256, actual_sha) != 0) {
        err = ESP_FAIL;
    }
    mbedtls_sha256_free(&context.sha256);

    if (err != ESP_OK || status < 200 || status >= 300 || context.failed) {
        ESP_LOGE(TAG, "OTA download failed: err=%s status=%d bytes=%u",
                 esp_err_to_name(err), status, (unsigned)context.bytes_written);
        esp_ota_abort(context.handle);
        return err == ESP_OK ? ESP_FAIL : err;
    }

    if (manifest->size > 0 && context.bytes_written != manifest->size) {
        ESP_LOGE(TAG, "OTA size mismatch: expected %u got %u",
                 (unsigned)manifest->size, (unsigned)context.bytes_written);
        esp_ota_abort(context.handle);
        return ESP_ERR_INVALID_SIZE;
    }

    if (memcmp(actual_sha, expected_sha, sizeof(actual_sha)) != 0) {
        ESP_LOGE(TAG, "OTA SHA-256 mismatch");
        esp_ota_abort(context.handle);
        return ESP_ERR_INVALID_CRC;
    }

    err = esp_ota_end(context.handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA end failed: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_ota_set_boot_partition(partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA boot partition failed: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGW(TAG, "OTA update installed; reboot required");
    return ESP_OK;
}
