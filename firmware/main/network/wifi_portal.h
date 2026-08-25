#pragma once

#include "app_config.h"
#include "esp_err.h"

esp_err_t wifi_portal_init(void);
esp_err_t wifi_portal_connect_or_configure(device_config_t *config);
