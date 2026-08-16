#include "sensors.h"

#include <math.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define BATTERY_ENABLE_GPIO GPIO_NUM_21
#define BATTERY_ADC_CHANNEL ADC_CHANNEL_0
#define BATTERY_DIVIDER_MULTIPLIER 2.0f

#define I2C_PORT I2C_NUM_0
#define I2C_SDA_GPIO GPIO_NUM_19
#define I2C_SCL_GPIO GPIO_NUM_20
#define I2C_FREQ_HZ 100000
#define SHT4X_ADDR 0x44
#define SHT4X_MEASURE_HIGH_PRECISION 0xFD

static const char *TAG = "sensors";
static adc_oneshot_unit_handle_t s_adc_handle;
static adc_cali_handle_t s_adc_cali_handle;
static bool s_adc_calibrated;

static uint8_t sht4x_crc(const uint8_t *data)
{
    uint8_t crc = 0xFF;
    for (int i = 0; i < 2; i++) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; bit++) {
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

static float battery_percent_from_voltage(float voltage)
{
    static const struct {
        float voltage;
        float percent;
    } curve[] = {
        {4.15f, 100.0f},
        {3.96f, 90.0f},
        {3.91f, 80.0f},
        {3.85f, 70.0f},
        {3.80f, 60.0f},
        {3.75f, 50.0f},
        {3.68f, 40.0f},
        {3.58f, 30.0f},
        {3.49f, 20.0f},
        {3.41f, 10.0f},
        {3.30f, 5.0f},
        {3.27f, 0.0f},
    };

    if (voltage >= curve[0].voltage) {
        return 100.0f;
    }
    if (voltage <= curve[sizeof(curve) / sizeof(curve[0]) - 1].voltage) {
        return 0.0f;
    }

    for (size_t i = 0; i + 1 < sizeof(curve) / sizeof(curve[0]); i++) {
        if (voltage <= curve[i].voltage && voltage >= curve[i + 1].voltage) {
            float span = curve[i].voltage - curve[i + 1].voltage;
            float ratio = span > 0 ? (voltage - curve[i + 1].voltage) / span : 0;
            return curve[i + 1].percent + ratio * (curve[i].percent - curve[i + 1].percent);
        }
    }

    return 0.0f;
}

static esp_err_t init_adc(void)
{
    adc_oneshot_unit_init_cfg_t init_config = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_config, &s_adc_handle));

    adc_oneshot_chan_cfg_t channel_config = {
        .bitwidth = ADC_BITWIDTH_DEFAULT,
        .atten = ADC_ATTEN_DB_12,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc_handle, BATTERY_ADC_CHANNEL, &channel_config));

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cali_config = {
        .unit_id = ADC_UNIT_1,
        .chan = BATTERY_ADC_CHANNEL,
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    s_adc_calibrated = adc_cali_create_scheme_curve_fitting(&cali_config, &s_adc_cali_handle) == ESP_OK;
#endif

    return ESP_OK;
}

static esp_err_t init_i2c(void)
{
    i2c_config_t config = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_SDA_GPIO,
        .scl_io_num = I2C_SCL_GPIO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_FREQ_HZ,
    };

    ESP_ERROR_CHECK(i2c_param_config(I2C_PORT, &config));
    return i2c_driver_install(I2C_PORT, config.mode, 0, 0, 0);
}

esp_err_t sensors_init(void)
{
    gpio_config_t battery_enable = {
        .pin_bit_mask = 1ULL << BATTERY_ENABLE_GPIO,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&battery_enable));
    ESP_ERROR_CHECK(gpio_set_level(BATTERY_ENABLE_GPIO, 1));

    ESP_ERROR_CHECK(init_adc());
    ESP_ERROR_CHECK(init_i2c());
    return ESP_OK;
}

static esp_err_t read_battery(sensor_reading_t *reading)
{
    int raw = 0;
    ESP_RETURN_ON_ERROR(adc_oneshot_read(s_adc_handle, BATTERY_ADC_CHANNEL, &raw), TAG, "read battery adc");

    int millivolts = 0;
    if (s_adc_calibrated) {
        ESP_ERROR_CHECK(adc_cali_raw_to_voltage(s_adc_cali_handle, raw, &millivolts));
    } else {
        millivolts = (raw * 3300) / 4095;
    }

    reading->battery_voltage = (millivolts / 1000.0f) * BATTERY_DIVIDER_MULTIPLIER;
    reading->battery_percent = battery_percent_from_voltage(reading->battery_voltage);
    reading->has_battery = true;
    return ESP_OK;
}

static esp_err_t read_sht4x(sensor_reading_t *reading)
{
    uint8_t command = SHT4X_MEASURE_HIGH_PRECISION;
    uint8_t data[6] = {0};

    ESP_RETURN_ON_ERROR(
        i2c_master_write_to_device(I2C_PORT, SHT4X_ADDR, &command, 1, pdMS_TO_TICKS(100)),
        TAG,
        "sht4x command"
    );
    vTaskDelay(pdMS_TO_TICKS(10));
    ESP_RETURN_ON_ERROR(
        i2c_master_read_from_device(I2C_PORT, SHT4X_ADDR, data, sizeof(data), pdMS_TO_TICKS(100)),
        TAG,
        "sht4x read"
    );

    if (sht4x_crc(data) != data[2] || sht4x_crc(data + 3) != data[5]) {
        return ESP_ERR_INVALID_CRC;
    }

    uint16_t raw_temp = ((uint16_t)data[0] << 8) | data[1];
    uint16_t raw_hum = ((uint16_t)data[3] << 8) | data[4];
    reading->temperature_c = -45.0f + 175.0f * ((float)raw_temp / 65535.0f);
    reading->humidity_percent = -6.0f + 125.0f * ((float)raw_hum / 65535.0f);
    reading->humidity_percent = fminf(100.0f, fmaxf(0.0f, reading->humidity_percent));
    reading->has_temperature = true;
    reading->has_humidity = true;
    return ESP_OK;
}

static void read_rssi(sensor_reading_t *reading)
{
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
        reading->rssi = ap_info.rssi;
        reading->has_rssi = true;
    }
}

esp_err_t sensors_read(sensor_reading_t *reading)
{
    memset(reading, 0, sizeof(*reading));

    esp_err_t battery_err = read_battery(reading);
    if (battery_err != ESP_OK) {
        ESP_LOGW(TAG, "Battery read failed: %s", esp_err_to_name(battery_err));
    }

    esp_err_t sht_err = read_sht4x(reading);
    if (sht_err != ESP_OK) {
        ESP_LOGW(TAG, "SHT4x read failed: %s", esp_err_to_name(sht_err));
    }

    read_rssi(reading);
    return (battery_err == ESP_OK || sht_err == ESP_OK || reading->has_rssi) ? ESP_OK : ESP_FAIL;
}
