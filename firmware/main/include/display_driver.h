#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#define EINK_SCREEN_WIDTH 800
#define EINK_SCREEN_HEIGHT 480

esp_err_t display_driver_init(void);
esp_err_t display_driver_show_bmp(const uint8_t *bmp, size_t bmp_len);
esp_err_t display_driver_show_setup(const char *ssid, const char *pin);
esp_err_t display_driver_sleep(void);
