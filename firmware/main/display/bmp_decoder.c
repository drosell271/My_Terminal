#include "bmp_decoder.h"

#include <stdbool.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include "display_driver.h"
#include "esp_heap_caps.h"
#include "esp_log.h"

static const char *TAG = "bmp_decoder";

typedef struct {
    uint8_t r;
    uint8_t g;
    uint8_t b;
    uint8_t code;
} epaper_color_t;

static const epaper_color_t palette[] = {
    {0, 0, 0, 0x00},
    {255, 255, 255, 0x01},
    {255, 255, 0, 0x02},
    {255, 0, 0, 0x03},
    {0, 0, 255, 0x05},
    {0, 255, 0, 0x06},
};

static uint16_t read_u16_le(const uint8_t *data)
{
    return (uint16_t)data[0] | ((uint16_t)data[1] << 8);
}

static uint32_t read_u32_le(const uint8_t *data)
{
    return (uint32_t)data[0] |
           ((uint32_t)data[1] << 8) |
           ((uint32_t)data[2] << 16) |
           ((uint32_t)data[3] << 24);
}

static int32_t read_i32_le(const uint8_t *data)
{
    return (int32_t)read_u32_le(data);
}

static uint8_t dithered_gray(uint8_t gray, int x, int y)
{
    static const uint8_t threshold[4][4] = {
        {0, 8, 2, 10},
        {12, 4, 14, 6},
        {3, 11, 1, 9},
        {15, 7, 13, 5},
    };
    uint8_t black_coverage = (uint8_t)(((255 - gray) * 16) / 256);
    return threshold[y & 3][x & 3] < black_coverage ? 0x00 : 0x01;
}

static uint8_t nearest_epaper_color(uint8_t r, uint8_t g, uint8_t b, int x, int y)
{
    uint8_t max = r > g ? r : g;
    max = max > b ? max : b;
    uint8_t min = r < g ? r : g;
    min = min < b ? min : b;

    if (max - min <= 12) {
        uint8_t avg = (uint8_t)(((uint16_t)r + g + b) / 3);
        return dithered_gray(avg, x, y);
    }

    int best_index = 0;
    int best_distance = INT32_MAX;
    for (size_t i = 0; i < sizeof(palette) / sizeof(palette[0]); i++) {
        int dr = (int)r - palette[i].r;
        int dg = (int)g - palette[i].g;
        int db = (int)b - palette[i].b;
        int distance = dr * dr + dg * dg + db * db;
        if (distance < best_distance) {
            best_distance = distance;
            best_index = (int)i;
        }
    }

    return palette[best_index].code;
}

esp_err_t bmp_decode_to_epaper_4bpp(const uint8_t *bmp, size_t bmp_len, uint8_t **framebuffer, size_t *framebuffer_len)
{
    if (!bmp || bmp_len < 54 || !framebuffer || !framebuffer_len) {
        return ESP_ERR_INVALID_ARG;
    }

    if (bmp[0] != 'B' || bmp[1] != 'M') {
        ESP_LOGE(TAG, "Not a BMP file");
        return ESP_ERR_INVALID_RESPONSE;
    }

    uint32_t pixel_offset = read_u32_le(bmp + 10);
    uint32_t dib_size = read_u32_le(bmp + 14);
    int32_t width = read_i32_le(bmp + 18);
    int32_t height = read_i32_le(bmp + 22);
    uint16_t planes = read_u16_le(bmp + 26);
    uint16_t bpp = read_u16_le(bmp + 28);
    uint32_t compression = read_u32_le(bmp + 30);

    if (dib_size < 40 || width != EINK_SCREEN_WIDTH || abs(height) != EINK_SCREEN_HEIGHT ||
        planes != 1 || bpp != 24 || compression != 0) {
        ESP_LOGE(TAG, "Unsupported BMP: %ldx%ld bpp=%u compression=%lu",
                 (long)width, (long)height, bpp, (unsigned long)compression);
        return ESP_ERR_NOT_SUPPORTED;
    }

    const bool top_down = height < 0;
    const uint32_t row_stride = ((uint32_t)width * 3 + 3) & ~3U;
    const size_t required = pixel_offset + row_stride * EINK_SCREEN_HEIGHT;
    if (bmp_len < required) {
        ESP_LOGE(TAG, "Truncated BMP: %u required, %u received", (unsigned)required, (unsigned)bmp_len);
        return ESP_ERR_INVALID_SIZE;
    }

    const size_t out_len = (EINK_SCREEN_WIDTH * EINK_SCREEN_HEIGHT) / 2;
    uint8_t *out = heap_caps_malloc(out_len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!out) {
        out = heap_caps_malloc(out_len, MALLOC_CAP_8BIT);
    }
    if (!out) {
        return ESP_ERR_NO_MEM;
    }
    memset(out, 0x11, out_len);

    for (int y = 0; y < EINK_SCREEN_HEIGHT; y++) {
        int source_y = top_down ? y : (EINK_SCREEN_HEIGHT - 1 - y);
        const uint8_t *row = bmp + pixel_offset + (size_t)source_y * row_stride;

        for (int x = 0; x < EINK_SCREEN_WIDTH; x++) {
            const uint8_t *px = row + x * 3;
            uint8_t b = px[0];
            uint8_t g = px[1];
            uint8_t r = px[2];
            uint8_t code = nearest_epaper_color(r, g, b, x, y) & 0x0F;
            size_t out_index = ((size_t)y * EINK_SCREEN_WIDTH + x) / 2;

            if ((x & 1) == 0) {
                out[out_index] = (uint8_t)(code << 4);
            } else {
                out[out_index] |= code;
            }
        }
    }

    *framebuffer = out;
    *framebuffer_len = out_len;
    return ESP_OK;
}
