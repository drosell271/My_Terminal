const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { loadEnv } = require("./env");
const {
  DEFAULT_TIMEZONE,
  normalizeTimezone,
  publicTimezoneOptions,
  timezoneToPosix,
} = require("./timezones");

loadEnv();

const DB_FILE = process.env.DB_FILE || path.resolve(__dirname, "../data/app.sqlite");
const CALENDAR_COLORS = ["#0000FF", "#FF0000", "#00FF00", "#FFFF00"];

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    battery_percent REAL,
    temperature_c REAL,
    humidity_percent REAL,
    rssi INTEGER,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS device_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT NOT NULL,
    refresh_hours TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
    mqtt_host TEXT NOT NULL,
    mqtt_port INTEGER NOT NULL,
    mqtt_username TEXT NOT NULL,
    mqtt_password TEXT NOT NULL,
    mqtt_base_topic TEXT NOT NULL,
    screen_url TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    color TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_exceptions (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weather_location (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    label TEXT NOT NULL,
    country TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    units TEXT NOT NULL,
    openweather_api_key TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS screen_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    month_offset INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS external_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

migrateSchema();
seedDefaults();
sanitizeUnsafeServerUrl();

function migrateSchema() {
  ensureColumn(
    "weather_location",
    "openweather_api_key",
    "TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    "device_settings",
    "timezone",
    `TEXT NOT NULL DEFAULT '${DEFAULT_TIMEZONE}'`,
  );
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function seedDefaults() {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO sensor_readings (
      id, battery_percent, temperature_c, humidity_percent, rssi, updated_at
    ) VALUES (1, 86, 23.8, 46, -61, ?)
  `).run(now);

  db.prepare(`
    INSERT OR IGNORE INTO device_settings (
      id, device_id, refresh_hours, timezone, mqtt_host, mqtt_port, mqtt_username,
      mqtt_password, mqtt_base_topic, screen_url, updated_at
    ) VALUES (
      1, 'seeed-e1002', '["07:00","12:00","18:00"]', ?, 'mqtt.local', 1883,
      '', '', 'home/eink/e1002', ?, ?
    )
  `).run(DEFAULT_TIMEZONE, getConfiguredPublicBaseUrl(), now);

  const existingCalendars = db.prepare("SELECT COUNT(*) AS count FROM calendars").get();
  if (existingCalendars.count === 0) {
    const defaults = [
      ["Daniel", "", "#0000FF"],
      ["Alfonso", "", "#FF0000"],
      ["Raquel", "", "#00FF00"],
      ["Ángel", "", "#FFFF00"],
    ];

    const insert = db.prepare(`
      INSERT INTO calendars (
        id, position, name, url, color, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    defaults.forEach(([name, url, color], index) => {
      insert.run(randomUUID(), index, name, url, color, 1, now);
    });
  }

  db.prepare(`
    INSERT OR IGNORE INTO weather_location (
      id, label, country, latitude, longitude, units, updated_at
    ) VALUES (1, 'Madrid', 'ES', 40.4168, -3.7038, 'metric', ?)
  `).run(now);

  db.prepare(`
    INSERT OR IGNORE INTO screen_state (
      id, month_offset, updated_at
    ) VALUES (1, 0, ?)
  `).run(now);
}

function sanitizeUnsafeServerUrl() {
  const row = db.prepare("SELECT screen_url FROM device_settings WHERE id = 1").get();
  if (!row) {
    return;
  }

  const current = normalizeServerUrl(row.screen_url, "");
  if (!current || !isLoopbackServerUrl(current)) {
    return;
  }

  const replacement = getConfiguredPublicBaseUrl();
  db.prepare(`
    UPDATE device_settings
    SET screen_url = ?,
        updated_at = ?
    WHERE id = 1
  `).run(replacement, new Date().toISOString());
}

function getDashboard() {
  return {
    sensors: getSensors(),
    settings: getDeviceSettings(),
    calendars: getCalendars(),
    eventExceptions: getEventExceptions(),
    weatherLocation: getWeatherLocation(),
    screenState: getScreenState(),
  };
}

function getSensors() {
  const row = db.prepare(`
    SELECT battery_percent, temperature_c, humidity_percent, rssi, updated_at
    FROM sensor_readings
    WHERE id = 1
  `).get();

  return {
    batteryPercent: row.battery_percent,
    temperatureC: row.temperature_c,
    humidityPercent: row.humidity_percent,
    rssi: row.rssi,
    updatedAt: row.updated_at,
  };
}

function saveSensors(payload) {
  const current = getSensors();
  const next = {
    batteryPercent:
      payload.batteryPercent === undefined
        ? current.batteryPercent
        : normalizeOptionalNumber(payload.batteryPercent, 0, 100),
    temperatureC:
      payload.temperatureC === undefined
        ? current.temperatureC
        : normalizeOptionalNumber(payload.temperatureC, -40, 85),
    humidityPercent:
      payload.humidityPercent === undefined
        ? current.humidityPercent
        : normalizeOptionalNumber(payload.humidityPercent, 0, 100),
    rssi:
      payload.rssi === undefined
        ? current.rssi
        : normalizeOptionalInteger(payload.rssi, -150, 20),
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };

  db.prepare(`
    UPDATE sensor_readings
    SET battery_percent = ?,
        temperature_c = ?,
        humidity_percent = ?,
        rssi = ?,
        updated_at = ?
    WHERE id = 1
  `).run(
    next.batteryPercent,
    next.temperatureC,
    next.humidityPercent,
    next.rssi,
    next.updatedAt,
  );

  return getSensors();
}

function getDeviceSettings() {
  const row = db.prepare(`
    SELECT device_id, refresh_hours, timezone, mqtt_host, mqtt_port, mqtt_username,
           mqtt_password, mqtt_base_topic, screen_url, updated_at
    FROM device_settings
    WHERE id = 1
  `).get();
  const serverUrl = normalizeStoredServerUrl(row.screen_url);
  const timezone = normalizeTimezone(row.timezone);

  return {
    deviceId: row.device_id,
    refreshHours: parseJson(row.refresh_hours, []),
    timezone,
    timezonePosix: timezoneToPosix(timezone),
    timezoneOptions: publicTimezoneOptions(),
    mqttHost: row.mqtt_host,
    mqttPort: row.mqtt_port,
    mqttUsername: row.mqtt_username,
    mqttPassword: row.mqtt_password,
    mqttBaseTopic: row.mqtt_base_topic,
    serverUrl,
    screenUrl: serverUrl ? `${serverUrl}/api/screen.bmp` : "",
    updatedAt: row.updated_at,
  };
}

function saveDeviceSettings(payload) {
  const current = getDeviceSettings();
  const next = {
    deviceId: normalizeText(payload.deviceId, current.deviceId, 64),
    refreshHours: normalizeRefreshHours(payload.refreshHours, current.refreshHours),
    timezone: normalizeTimezone(payload.timezone, current.timezone),
    mqttHost: normalizeText(payload.mqttHost, current.mqttHost, 255),
    mqttPort: normalizeInteger(payload.mqttPort, current.mqttPort, 1, 65535),
    mqttUsername: normalizeText(payload.mqttUsername, current.mqttUsername, 128, true),
    mqttPassword: normalizeText(payload.mqttPassword, current.mqttPassword, 128, true),
    mqttBaseTopic: normalizeText(payload.mqttBaseTopic, current.mqttBaseTopic, 128),
    serverUrl: normalizeServerUrl(payload.serverUrl ?? payload.screenUrl, current.serverUrl),
    updatedAt: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE device_settings
    SET device_id = ?,
        refresh_hours = ?,
        timezone = ?,
        mqtt_host = ?,
        mqtt_port = ?,
        mqtt_username = ?,
        mqtt_password = ?,
        mqtt_base_topic = ?,
        screen_url = ?,
        updated_at = ?
    WHERE id = 1
  `).run(
    next.deviceId,
    JSON.stringify(next.refreshHours),
    next.timezone,
    next.mqttHost,
    next.mqttPort,
    next.mqttUsername,
    next.mqttPassword,
    next.mqttBaseTopic,
    next.serverUrl,
    next.updatedAt,
  );

  return getDeviceSettings();
}

function getCalendars() {
  return db.prepare(`
    SELECT id, position, name, url, color, enabled, updated_at
    FROM calendars
    ORDER BY position ASC
  `).all().map((row) => ({
    id: row.id,
    position: row.position,
    name: row.name,
    url: row.url,
    color: row.color,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  }));
}

function saveCalendars(calendars) {
  if (!Array.isArray(calendars)) {
    throw new Error("calendars must be an array");
  }

  if (calendars.length > 4) {
    throw new Error("Only up to 4 calendars are supported");
  }

  const now = new Date().toISOString();
  const normalized = calendars.map((calendar, index) => normalizeCalendar(calendar, index, now));

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM calendars").run();
    const insert = db.prepare(`
      INSERT INTO calendars (
        id, position, name, url, color, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    normalized.forEach((calendar) => {
      insert.run(
        calendar.id,
        calendar.position,
        calendar.name,
        calendar.url,
        calendar.color,
        calendar.enabled ? 1 : 0,
        calendar.updatedAt,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getCalendars();
}

function getEventExceptions() {
  return db.prepare(`
    SELECT id, keyword, updated_at
    FROM event_exceptions
    ORDER BY keyword ASC
  `).all().map((row) => ({
    id: row.id,
    keyword: row.keyword,
    updatedAt: row.updated_at,
  }));
}

function saveEventExceptions(keywords) {
  if (!Array.isArray(keywords)) {
    throw new Error("keywords must be an array");
  }

  const now = new Date().toISOString();
  const uniqueKeywords = [...new Set(
    keywords
      .map((keyword) => String(keyword || "").trim())
      .filter(Boolean),
  )].slice(0, 40);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM event_exceptions").run();
    const insert = db.prepare(`
      INSERT INTO event_exceptions (id, keyword, updated_at)
      VALUES (?, ?, ?)
    `);

    uniqueKeywords.forEach((keyword) => {
      insert.run(randomUUID(), keyword.slice(0, 120), now);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getEventExceptions();
}

function getWeatherLocation(options = {}) {
  const row = db.prepare(`
    SELECT label, country, latitude, longitude, units, openweather_api_key, updated_at
    FROM weather_location
    WHERE id = 1
  `).get();

  const location = {
    label: row.label,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    units: row.units,
    hasOpenWeatherApiKey: Boolean(row.openweather_api_key),
    updatedAt: row.updated_at,
  };

  if (options.includeSecret) {
    location.openWeatherApiKey = row.openweather_api_key;
  }

  return location;
}

function saveWeatherLocation(payload) {
  const current = getWeatherLocation({ includeSecret: true });
  const apiKey = normalizeOptionalSecret(payload.openWeatherApiKey, 160);
  const next = {
    label: normalizeText(payload.label, current.label, 120),
    country: normalizeText(payload.country, current.country, 2),
    latitude: normalizeOptionalNumber(payload.latitude, -90, 90),
    longitude: normalizeOptionalNumber(payload.longitude, -180, 180),
    units: ["metric", "imperial", "standard"].includes(payload.units)
      ? payload.units
      : current.units,
    openWeatherApiKey: payload.clearOpenWeatherApiKey
      ? ""
      : apiKey || current.openWeatherApiKey || "",
    updatedAt: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE weather_location
    SET label = ?,
        country = ?,
        latitude = ?,
        longitude = ?,
        units = ?,
        openweather_api_key = ?,
        updated_at = ?
    WHERE id = 1
  `).run(
    next.label,
    next.country.toUpperCase(),
    next.latitude,
    next.longitude,
    next.units,
    next.openWeatherApiKey,
    next.updatedAt,
  );

  return getWeatherLocation();
}

function getScreenState() {
  const row = db.prepare(`
    SELECT month_offset, updated_at
    FROM screen_state
    WHERE id = 1
  `).get();

  return {
    monthOffset: row.month_offset,
    updatedAt: row.updated_at,
  };
}

function setScreenMonthOffset(value) {
  const offset = normalizeInteger(value, 0, -36, 36);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE screen_state
    SET month_offset = ?,
        updated_at = ?
    WHERE id = 1
  `).run(offset, now);

  return getScreenState();
}

function moveScreenMonth(delta) {
  const current = getScreenState();
  return setScreenMonthOffset(current.monthOffset + delta);
}

function resetScreenMonth() {
  return setScreenMonthOffset(0);
}

function getCacheEntry(key) {
  const row = db.prepare(`
    SELECT value, expires_at
    FROM external_cache
    WHERE key = ?
  `).get(key);

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM external_cache WHERE key = ?").run(key);
    return null;
  }

  return parseJson(row.value, null);
}

function setCacheEntry(key, value, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  db.prepare(`
    INSERT INTO external_cache (key, value, expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), expiresAt, now.toISOString());

  return value;
}

function normalizeCalendar(calendar, index, now) {
  const source = calendar || {};

  return {
    id: normalizeId(source.id),
    position: index,
    name: normalizeText(source.name, `Calendario ${index + 1}`, 80),
    url: normalizeOptionalUrl(source.url),
    color: CALENDAR_COLORS[index] || "#000000",
    enabled: source.enabled !== false,
    updatedAt: now,
  };
}

function normalizeRefreshHours(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const hours = [...new Set(
    value
      .map((item) => String(item || "").trim())
      .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item)),
  )].sort();

  return hours.length > 0 ? hours.slice(0, 12) : fallback;
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : randomUUID();
}

function normalizeText(value, fallback, maxLength, allowEmpty = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim().slice(0, maxLength);
  if (!allowEmpty && !text) {
    return fallback;
  }

  return text;
}

function normalizeOptionalSecret(value, maxLength) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim().slice(0, maxLength);
}

function normalizeServerUrl(value, fallback) {
  if (value === undefined || value === null) {
    return fallback || "";
  }

  const raw = String(value).trim().slice(0, 128);
  if (!raw) {
    return "";
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new Error("Server URL must be a valid http:// or https:// URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Server URL must start with http:// or https://");
  }

  parsed.hash = "";
  parsed.search = "";

  if (parsed.pathname.endsWith("/api/screen.bmp")) {
    parsed.pathname = parsed.pathname.slice(0, -"/api/screen.bmp".length) || "/";
  } else if (parsed.pathname.startsWith("/api/")) {
    parsed.pathname = "/";
  }

  return parsed.toString().replace(/\/$/, "");
}

function normalizeStoredServerUrl(value) {
  const publicBaseUrl = getConfiguredPublicBaseUrl();

  try {
    const serverUrl = normalizeServerUrl(value, "");
    if (serverUrl && !isLoopbackServerUrl(serverUrl)) {
      return serverUrl;
    }
  } catch (_error) {
    // Fall through to PUBLIC_BASE_URL.
  }

  return publicBaseUrl;
}

function getConfiguredPublicBaseUrl() {
  try {
    const serverUrl = normalizeServerUrl(process.env.PUBLIC_BASE_URL, "");
    return isLoopbackServerUrl(serverUrl) ? "" : serverUrl;
  } catch (_error) {
    return "";
  }
}

function isLoopbackServerUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host.startsWith("127.")
    );
  } catch (_error) {
    return false;
  }
}

function normalizeOptionalUrl(value) {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }

  if (!/^(https?|webcal):\/\//i.test(url)) {
    throw new Error("URL must start with http://, https:// or webcal://");
  }

  return url.slice(0, 500);
}

function normalizeOptionalNumber(value, min, max) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Number must be between ${min} and ${max}`);
  }

  return number;
}

function normalizeOptionalInteger(value, min, max) {
  const number = normalizeOptionalNumber(value, min, max);
  return number === null ? null : Math.round(number);
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return fallback;
  }

  return number;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

module.exports = {
  CALENDAR_COLORS,
  getDashboard,
  getSensors,
  saveSensors,
  getDeviceSettings,
  saveDeviceSettings,
  getCalendars,
  saveCalendars,
  getEventExceptions,
  saveEventExceptions,
  getWeatherLocation,
  saveWeatherLocation,
  getScreenState,
  setScreenMonthOffset,
  moveScreenMonth,
  resetScreenMonth,
  getCacheEntry,
  setCacheEntry,
  normalizeServerUrl,
  normalizeStoredServerUrl,
  isLoopbackServerUrl,
};
