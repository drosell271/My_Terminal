#pragma once

#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    float battery_percent;
    float battery_voltage;
    float temperature_c;
    float humidity_percent;
    int rssi;
    char mac[18];
    bool has_battery;
    bool has_temperature;
    bool has_humidity;
    bool has_rssi;
    bool has_mac;
} sensor_reading_t;

esp_err_t sensors_init(void);
esp_err_t sensors_read(sensor_reading_t *reading);
void sensors_sleep(void);
