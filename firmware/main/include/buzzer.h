#pragma once

#include <stdint.h>
#include "esp_err.h"

esp_err_t buzzer_init(void);
esp_err_t buzzer_beep(uint32_t frequency_hz, uint32_t duration_ms);
