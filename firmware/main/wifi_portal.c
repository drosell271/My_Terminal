#include "wifi_portal.h"

#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "display_driver.h"
#include "esp_event.h"
#include "esp_check.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "sys/param.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1
#define PROVISION_SUBMITTED_BIT BIT2
#define MAX_STA_RETRIES 8
#define PROVISION_PIN_LEN 6

static const char *TAG = "wifi_portal";
static EventGroupHandle_t s_event_group;
static int s_retry_count;
static httpd_handle_t s_httpd;
static device_config_t s_submitted_config;
static char s_portal_pin[PROVISION_PIN_LEN + 1];

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;
    (void)event_data;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_count < MAX_STA_RETRIES) {
            s_retry_count++;
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        s_retry_count = 0;
        xEventGroupSetBits(s_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_portal_init(void)
{
    s_event_group = xEventGroupCreate();
    if (!s_event_group) {
        return ESP_ERR_NO_MEM;
    }

    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    return ESP_OK;
}

static esp_err_t connect_station(const device_config_t *config, bool keep_ap)
{
    wifi_config_t sta_config = {0};
    strlcpy((char *)sta_config.sta.ssid, config->wifi_ssid, sizeof(sta_config.sta.ssid));
    strlcpy((char *)sta_config.sta.password, config->wifi_password, sizeof(sta_config.sta.password));
    sta_config.sta.threshold.authmode = config->wifi_password[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;

    s_retry_count = 0;
    xEventGroupClearBits(s_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);

    ESP_ERROR_CHECK(esp_wifi_set_mode(keep_ap ? WIFI_MODE_APSTA : WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta_config));

    esp_err_t err = esp_wifi_start();
    if (err != ESP_OK && err != ESP_ERR_WIFI_CONN && err != ESP_ERR_WIFI_STATE) {
        return err;
    }
    esp_wifi_connect();

    EventBits_t bits = xEventGroupWaitBits(
        s_event_group,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(30000)
    );

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi connected to %s", config->wifi_ssid);
        return ESP_OK;
    }

    ESP_LOGW(TAG, "WiFi connection failed for %s", config->wifi_ssid);
    return ESP_FAIL;
}

static const char *portal_html =
    "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>E1002 setup</title><style>"
    "body{font-family:system-ui,sans-serif;margin:24px;background:#f4f4f4;color:#111}"
    "main{max-width:520px;margin:auto;background:#fff;border:1px solid #bbb;padding:18px;border-radius:8px}"
    "label{display:block;margin:14px 0 6px;font-weight:700}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #999;border-radius:6px;font-size:16px}"
    "button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:6px;background:#111;color:#fff;font-weight:800;font-size:16px}"
    "p{line-height:1.4}</style></head><body><main>"
    "<h1>Configurar E1002</h1>"
    "<p>Conectate al hotspot E1002, abre <b>http://192.168.4.1</b> e introduce el PIN mostrado en la pantalla.</p>"
    "<form method='post' action='/save'>"
    "<label>PIN pantalla</label><input name='pin' inputmode='numeric' pattern='[0-9]{6}' maxlength='6' required>"
    "<label>WiFi SSID</label><input name='ssid' maxlength='32' required>"
    "<label>WiFi password</label><input name='password' type='password' maxlength='64'>"
    "<label>Servidor</label><input name='server' maxlength='128' placeholder='http://192.168.1.50:3000' required>"
    "<label>Token dispositivo</label><input name='token' type='password' maxlength='128' placeholder='Opcional'>"
    "<button type='submit'>Guardar y conectar</button>"
    "</form></main></body></html>";

static esp_err_t root_get_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, portal_html, HTTPD_RESP_USE_STRLEN);
}

static int hex_value(char c)
{
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return 10 + c - 'a';
    }
    if (c >= 'A' && c <= 'F') {
        return 10 + c - 'A';
    }
    return -1;
}

static void url_decode(char *value)
{
    char *out = value;
    for (char *in = value; *in; in++) {
        if (*in == '+') {
            *out++ = ' ';
        } else if (*in == '%' && isxdigit((unsigned char)in[1]) && isxdigit((unsigned char)in[2])) {
            *out++ = (char)((hex_value(in[1]) << 4) | hex_value(in[2]));
            in += 2;
        } else {
            *out++ = *in;
        }
    }
    *out = '\0';
}

static bool form_value(const char *body, const char *key, char *target, size_t target_len)
{
    const size_t key_len = strlen(key);
    const char *cursor = body;

    while (cursor && *cursor) {
        if (strncmp(cursor, key, key_len) == 0 && cursor[key_len] == '=') {
            const char *start = cursor + key_len + 1;
            const char *end = strchr(start, '&');
            size_t len = end ? (size_t)(end - start) : strlen(start);
            if (len >= target_len) {
                len = target_len - 1;
            }
            memcpy(target, start, len);
            target[len] = '\0';
            url_decode(target);
            return true;
        }

        cursor = strchr(cursor, '&');
        if (cursor) {
            cursor++;
        }
    }

    target[0] = '\0';
    return false;
}

static void trim_trailing_slash(char *value)
{
    size_t len = strlen(value);
    while (len > 0 && value[len - 1] == '/') {
        value[len - 1] = '\0';
        len--;
    }
}

static void generate_portal_pin(char *target, size_t target_len)
{
    uint32_t pin = 100000U + (esp_random() % 900000U);
    snprintf(target, target_len, "%06lu", (unsigned long)pin);
}

static esp_err_t save_post_handler(httpd_req_t *req)
{
    char body[768] = {0};
    char entered_pin[16] = {0};
    int remaining = req->content_len;
    int received = 0;

    while (remaining > 0 && received < (int)sizeof(body) - 1) {
        int ret = httpd_req_recv(req, body + received, MIN(remaining, (int)sizeof(body) - 1 - received));
        if (ret <= 0) {
            return ESP_FAIL;
        }
        received += ret;
        remaining -= ret;
    }
    body[received] = '\0';

    form_value(body, "pin", entered_pin, sizeof(entered_pin));
    if (strcmp(entered_pin, s_portal_pin) != 0) {
        httpd_resp_set_status(req, "403 Forbidden");
        return httpd_resp_sendstr(req, "PIN incorrecto");
    }

    memset(&s_submitted_config, 0, sizeof(s_submitted_config));
    form_value(body, "ssid", s_submitted_config.wifi_ssid, sizeof(s_submitted_config.wifi_ssid));
    form_value(body, "password", s_submitted_config.wifi_password, sizeof(s_submitted_config.wifi_password));
    form_value(body, "server", s_submitted_config.server_url, sizeof(s_submitted_config.server_url));
    form_value(body, "token", s_submitted_config.device_token, sizeof(s_submitted_config.device_token));
    trim_trailing_slash(s_submitted_config.server_url);

    if (!app_config_is_complete(&s_submitted_config)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Faltan SSID o servidor");
    }

    ESP_ERROR_CHECK(app_config_save(&s_submitted_config));
    xEventGroupSetBits(s_event_group, PROVISION_SUBMITTED_BIT);

    httpd_resp_set_type(req, "text/html");
    return httpd_resp_sendstr(req, "<html><body><h1>Guardado</h1><p>El dispositivo va a conectarse a la WiFi.</p></body></html>");
}

static esp_err_t start_http_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.lru_purge_enable = true;

    ESP_RETURN_ON_ERROR(httpd_start(&s_httpd, &config), TAG, "start httpd");

    httpd_uri_t root = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_get_handler,
    };
    httpd_uri_t save = {
        .uri = "/save",
        .method = HTTP_POST,
        .handler = save_post_handler,
    };
    ESP_ERROR_CHECK(httpd_register_uri_handler(s_httpd, &root));
    ESP_ERROR_CHECK(httpd_register_uri_handler(s_httpd, &save));
    return ESP_OK;
}

static void stop_http_server(void)
{
    if (s_httpd) {
        httpd_stop(s_httpd);
        s_httpd = NULL;
    }
}

static esp_err_t start_access_point(void)
{
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP));

    char ssid[32];

    snprintf(ssid, sizeof(ssid), "EINK-E1002-%02X%02X", mac[4], mac[5]);
    generate_portal_pin(s_portal_pin, sizeof(s_portal_pin));

    wifi_config_t ap_config = {0};
    strlcpy((char *)ap_config.ap.ssid, ssid, sizeof(ap_config.ap.ssid));
    ap_config.ap.ssid_len = strlen(ssid);
    ap_config.ap.channel = 1;
    ap_config.ap.max_connection = 4;
    ap_config.ap.authmode = WIFI_AUTH_OPEN;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    esp_err_t err = esp_wifi_start();
    if (err != ESP_OK && err != ESP_ERR_WIFI_CONN && err != ESP_ERR_WIFI_STATE) {
        return err;
    }

    ESP_LOGW(TAG, "Provisioning AP ready: SSID=%s PIN=%s URL=http://192.168.4.1", ssid, s_portal_pin);
    ESP_RETURN_ON_ERROR(start_http_server(), TAG, "start httpd");

    err = display_driver_show_setup(ssid, s_portal_pin);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Setup screen skipped: %s", esp_err_to_name(err));
    }
    return ESP_OK;
}

static esp_err_t run_provisioning(device_config_t *config)
{
    xEventGroupClearBits(s_event_group, PROVISION_SUBMITTED_BIT);
    ESP_RETURN_ON_ERROR(start_access_point(), TAG, "start access point");

    xEventGroupWaitBits(s_event_group, PROVISION_SUBMITTED_BIT, pdTRUE, pdFALSE, portMAX_DELAY);
    *config = s_submitted_config;

    esp_err_t err = connect_station(config, true);
    if (err == ESP_OK) {
        stop_http_server();
        ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    }
    return err;
}

esp_err_t wifi_portal_connect_or_configure(device_config_t *config)
{
    if (app_config_is_complete(config) && connect_station(config, false) == ESP_OK) {
        return ESP_OK;
    }

    ESP_LOGW(TAG, "Starting first-run WiFi configuration portal");
    return run_provisioning(config);
}
