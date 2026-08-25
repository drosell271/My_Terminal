#include "display_driver.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bmp_decoder.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "epaper.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"

#define EPD_SPI_HOST SPI2_HOST
#define EPD_SPI_SPEED_HZ 10000000
#define EPD_PIN_SCLK GPIO_NUM_7
#define EPD_PIN_MOSI GPIO_NUM_9
#define EPD_PIN_CS GPIO_NUM_10
#define EPD_PIN_DC GPIO_NUM_11
#define EPD_PIN_RST GPIO_NUM_12
#define EPD_PIN_BUSY GPIO_NUM_13

static const char *TAG = "display";
static epd_handle_t s_epd;

#define EPD_BLACK 0x00
#define EPD_WHITE 0x01
#define EPD_BLUE 0x05

static const uint8_t glyph_digits[10][7] = {
    {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E},
    {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E},
    {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
    {0x1E, 0x01, 0x01, 0x0E, 0x01, 0x01, 0x1E},
    {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
    {0x1F, 0x10, 0x10, 0x1E, 0x01, 0x01, 0x1E},
    {0x0E, 0x10, 0x10, 0x1E, 0x11, 0x11, 0x0E},
    {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
    {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
    {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x01, 0x0E},
};

static const uint8_t glyph_letters[26][7] = {
    {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
    {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E},
    {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
    {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E},
    {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F},
    {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10},
    {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0E},
    {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
    {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E},
    {0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0E},
    {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11},
    {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
    {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11},
    {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11},
    {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
    {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10},
    {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D},
    {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
    {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E},
    {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},
    {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
    {0x11, 0x11, 0x11, 0x11, 0x0A, 0x0A, 0x04},
    {0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A},
    {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
    {0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04},
    {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F},
};

static const uint8_t glyph_dash[7] = {0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00};
static const uint8_t glyph_dot[7] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C};
static const uint8_t glyph_colon[7] = {0x00, 0x0C, 0x0C, 0x00, 0x0C, 0x0C, 0x00};
static const uint8_t glyph_slash[7] = {0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10};

static const uint8_t *glyph_for(char c)
{
    if (c >= 'a' && c <= 'z') {
        c = (char)(c - 'a' + 'A');
    }
    if (c >= 'A' && c <= 'Z') {
        return glyph_letters[c - 'A'];
    }
    if (c >= '0' && c <= '9') {
        return glyph_digits[c - '0'];
    }
    if (c == '-') {
        return glyph_dash;
    }
    if (c == '.') {
        return glyph_dot;
    }
    if (c == ':') {
        return glyph_colon;
    }
    if (c == '/') {
        return glyph_slash;
    }
    return NULL;
}

static void set_pixel(uint8_t *framebuffer, int x, int y, uint8_t color)
{
    if (x < 0 || x >= EINK_SCREEN_WIDTH || y < 0 || y >= EINK_SCREEN_HEIGHT) {
        return;
    }

    size_t index = ((size_t)y * EINK_SCREEN_WIDTH + x) / 2;
    if ((x & 1) == 0) {
        framebuffer[index] = (uint8_t)((framebuffer[index] & 0x0F) | ((color & 0x0F) << 4));
    } else {
        framebuffer[index] = (uint8_t)((framebuffer[index] & 0xF0) | (color & 0x0F));
    }
}

static void fill_rect(uint8_t *framebuffer, int x, int y, int width, int height, uint8_t color)
{
    for (int py = y; py < y + height; py++) {
        for (int px = x; px < x + width; px++) {
            set_pixel(framebuffer, px, py, color);
        }
    }
}

static int text_width(const char *text, int scale)
{
    int width = 0;
    for (const char *cursor = text; *cursor; cursor++) {
        width += ((*cursor == ' ') ? 4 : 6) * scale;
    }
    return width > 0 ? width - scale : 0;
}

static void draw_char(uint8_t *framebuffer, int x, int y, char c, int scale, uint8_t color)
{
    const uint8_t *glyph = glyph_for(c);
    if (!glyph) {
        return;
    }

    for (int row = 0; row < 7; row++) {
        for (int col = 0; col < 5; col++) {
            if (glyph[row] & (1 << (4 - col))) {
                fill_rect(framebuffer, x + col * scale, y + row * scale, scale, scale, color);
            }
        }
    }
}

static void draw_text(uint8_t *framebuffer, int x, int y, const char *text, int scale, uint8_t color)
{
    for (const char *cursor = text; *cursor; cursor++) {
        if (*cursor != ' ') {
            draw_char(framebuffer, x, y, *cursor, scale, color);
        }
        x += ((*cursor == ' ') ? 4 : 6) * scale;
    }
}

static void draw_centered(uint8_t *framebuffer, int y, const char *text, int scale, uint8_t color)
{
    int x = (EINK_SCREEN_WIDTH - text_width(text, scale)) / 2;
    draw_text(framebuffer, x, y, text, scale, color);
}

static esp_err_t display_driver_show_framebuffer(uint8_t *framebuffer)
{
    if (!s_epd) {
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = epd_wake(s_epd);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "epd wake failed: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "Updating e-paper framebuffer");
    return epd_update(s_epd, framebuffer, EPD_UPDATE_FULL);
}

esp_err_t display_driver_init(void)
{
    epd_config_t cfg = EPD_CONFIG_73_6COLOR();
    cfg.pins.busy = EPD_PIN_BUSY;
    cfg.pins.rst = EPD_PIN_RST;
    cfg.pins.dc = EPD_PIN_DC;
    cfg.pins.cs = EPD_PIN_CS;
    cfg.pins.sck = EPD_PIN_SCLK;
    cfg.pins.mosi = EPD_PIN_MOSI;
    cfg.spi.host = EPD_SPI_HOST;
    cfg.spi.speed_hz = EPD_SPI_SPEED_HZ;

    ESP_RETURN_ON_ERROR(epd_init(&cfg, &s_epd), TAG, "epd init");

    epd_panel_info_t info = {0};
    if (epd_get_info(s_epd, &info) == ESP_OK) {
        ESP_LOGI(TAG, "E-paper ready: %ux%u", info.width, info.height);
    }

    return ESP_OK;
}

esp_err_t display_driver_show_bmp(const uint8_t *bmp, size_t bmp_len)
{
    if (!s_epd) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t *framebuffer = NULL;
    size_t framebuffer_len = 0;
    ESP_RETURN_ON_ERROR(
        bmp_decode_to_epaper_4bpp(bmp, bmp_len, &framebuffer, &framebuffer_len),
        TAG,
        "decode bmp"
    );

    ESP_LOGI(TAG, "Updating e-paper with %u bytes", (unsigned)framebuffer_len);
    esp_err_t err = display_driver_show_framebuffer(framebuffer);
    free(framebuffer);
    return err;
}

esp_err_t display_driver_show_setup(const char *ssid, const char *pin)
{
    if (!s_epd || !ssid || !pin) {
        return ESP_ERR_INVALID_STATE;
    }

    const size_t framebuffer_len = (EINK_SCREEN_WIDTH * EINK_SCREEN_HEIGHT) / 2;
    uint8_t *framebuffer = heap_caps_malloc(framebuffer_len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!framebuffer) {
        framebuffer = heap_caps_malloc(framebuffer_len, MALLOC_CAP_8BIT);
    }
    if (!framebuffer) {
        return ESP_ERR_NO_MEM;
    }

    memset(framebuffer, 0x11, framebuffer_len);
    fill_rect(framebuffer, 0, 0, EINK_SCREEN_WIDTH, 20, EPD_BLACK);
    fill_rect(framebuffer, 0, EINK_SCREEN_HEIGHT - 20, EINK_SCREEN_WIDTH, 20, EPD_BLACK);

    draw_centered(framebuffer, 54, "CONFIGURACION", 7, EPD_BLACK);
    draw_centered(framebuffer, 118, "WIFI", 8, EPD_BLUE);
    draw_centered(framebuffer, 206, "SSID", 4, EPD_BLACK);
    draw_centered(framebuffer, 246, ssid, 6, EPD_BLACK);
    char pin_line[32];
    snprintf(pin_line, sizeof(pin_line), "PIN %s", pin);
    draw_centered(framebuffer, 326, pin_line, 5, EPD_BLACK);
    draw_centered(framebuffer, 390, "HTTP://192.168.4.1", 5, EPD_BLACK);

    esp_err_t err = display_driver_show_framebuffer(framebuffer);
    free(framebuffer);
    return err;
}

esp_err_t display_driver_sleep(void)
{
    if (!s_epd) {
        return ESP_OK;
    }

    return epd_sleep(s_epd);
}
