#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

typedef enum {
    BUTTON_ACTION_PREVIOUS_MONTH,
    BUTTON_ACTION_NEXT_MONTH,
    BUTTON_ACTION_CURRENT_MONTH,
} button_action_t;

typedef void (*button_action_callback_t)(button_action_t action);

esp_err_t buttons_init(button_action_callback_t callback);
bool buttons_wait_for_action(button_action_t *action, uint32_t timeout_ms);
void buttons_clear_pending(void);
