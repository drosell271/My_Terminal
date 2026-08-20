#include "mqtt_app.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "esp_event.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mqtt_client.h"

#define MQTT_CONNECT_WAIT_MS 2500

static const char *TAG = "mqtt_app";
static esp_mqtt_client_handle_t s_client;
static bool s_connected;
static char s_uri[192];

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
        s_connected = true;
        ESP_LOGI(TAG, "MQTT connected");
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected = false;
        ESP_LOGW(TAG, "MQTT disconnected");
        break;
    case MQTT_EVENT_ERROR:
        ESP_LOGW(TAG, "MQTT error");
        break;
    default:
        (void)event;
        break;
    }
}

void mqtt_app_stop(void)
{
    s_connected = false;
    if (s_client) {
        esp_mqtt_client_stop(s_client);
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
    }
}

esp_err_t mqtt_app_apply_settings(const app_settings_t *settings)
{
    mqtt_app_stop();

    if (!settings->mqtt_host[0] || !settings->mqtt_base_topic[0]) {
        ESP_LOGW(TAG, "MQTT disabled: missing host or base topic");
        return ESP_OK;
    }

    if (strstr(settings->mqtt_host, "://")) {
        strlcpy(s_uri, settings->mqtt_host, sizeof(s_uri));
    } else {
        snprintf(s_uri, sizeof(s_uri), "mqtt://%s:%d", settings->mqtt_host, settings->mqtt_port > 0 ? settings->mqtt_port : 1883);
    }

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = s_uri,
        .credentials.client_id = settings->device_id,
        .credentials.username = settings->mqtt_username[0] ? settings->mqtt_username : NULL,
        .credentials.authentication.password = settings->mqtt_password[0] ? settings->mqtt_password : NULL,
    };

    s_client = esp_mqtt_client_init(&mqtt_cfg);
    if (!s_client) {
        return ESP_FAIL;
    }

    ESP_ERROR_CHECK(esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL));
    ESP_ERROR_CHECK(esp_mqtt_client_start(s_client));
    ESP_LOGI(TAG, "MQTT starting: %s", s_uri);
    return ESP_OK;
}

static void number_or_null(char *target, size_t target_len, bool has_value, float value)
{
    if (!has_value) {
        strlcpy(target, "null", target_len);
    } else {
        snprintf(target, target_len, "%.2f", value);
    }
}

static bool wait_for_connection(uint32_t timeout_ms)
{
    const TickType_t started = xTaskGetTickCount();
    const TickType_t timeout_ticks = pdMS_TO_TICKS(timeout_ms);

    while (!s_connected && (xTaskGetTickCount() - started) < timeout_ticks) {
        vTaskDelay(pdMS_TO_TICKS(50));
    }

    return s_connected;
}

static esp_err_t publish_topic(const app_settings_t *settings, const char *suffix, const char *payload)
{
    char topic[MQTT_TOPIC_MAX_LEN + 32];
    snprintf(topic, sizeof(topic), "%s/%s", settings->mqtt_base_topic, suffix);

    int message_id = esp_mqtt_client_publish(s_client, topic, payload, 0, 1, 0);
    ESP_LOGI(TAG, "MQTT publish %s message_id=%d", topic, message_id);
    return message_id >= 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t mqtt_app_publish_sensors(const app_settings_t *settings, const sensor_reading_t *reading)
{
    if (!s_client || !settings->mqtt_base_topic[0]) {
        return ESP_OK;
    }

    if (!s_connected && !wait_for_connection(MQTT_CONNECT_WAIT_MS)) {
        ESP_LOGW(TAG, "MQTT publish skipped: not connected");
        return ESP_ERR_TIMEOUT;
    }

    char battery[16];
    char voltage[16];
    char temp[16];
    char humidity[16];
    char rssi[16];

    number_or_null(battery, sizeof(battery), reading->has_battery, reading->battery_percent);
    number_or_null(voltage, sizeof(voltage), reading->has_battery, reading->battery_voltage);
    number_or_null(temp, sizeof(temp), reading->has_temperature, reading->temperature_c);
    number_or_null(humidity, sizeof(humidity), reading->has_humidity, reading->humidity_percent);
    if (reading->has_rssi) {
        snprintf(rssi, sizeof(rssi), "%d", reading->rssi);
    } else {
        strlcpy(rssi, "null", sizeof(rssi));
    }

    esp_err_t status = ESP_OK;
    if (publish_topic(settings, "deviceId", settings->device_id) != ESP_OK) {
        status = ESP_FAIL;
    }
    if (publish_topic(settings, "battery/percent", battery) != ESP_OK) {
        status = ESP_FAIL;
    }
    if (publish_topic(settings, "battery/voltage", voltage) != ESP_OK) {
        status = ESP_FAIL;
    }
    if (publish_topic(settings, "temp", temp) != ESP_OK) {
        status = ESP_FAIL;
    }
    if (publish_topic(settings, "hum", humidity) != ESP_OK) {
        status = ESP_FAIL;
    }
    if (publish_topic(settings, "rssi", rssi) != ESP_OK) {
        status = ESP_FAIL;
    }

    return status;
}
