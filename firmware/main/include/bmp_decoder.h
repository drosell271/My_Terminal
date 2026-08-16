#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

esp_err_t bmp_decode_to_epaper_4bpp(const uint8_t *bmp, size_t bmp_len, uint8_t **framebuffer, size_t *framebuffer_len);
