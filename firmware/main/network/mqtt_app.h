#pragma once

#include "app_config.h"
#include "esp_err.h"
#include "sensors.h"

esp_err_t mqtt_app_apply_settings(const app_settings_t *settings);
esp_err_t mqtt_app_publish_sensors(const app_settings_t *settings, const sensor_reading_t *reading);
void mqtt_app_stop(void);
