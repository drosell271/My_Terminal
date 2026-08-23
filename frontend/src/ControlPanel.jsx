import React, { useEffect, useState } from "react";
import {
  Activity,
  Battery,
  CalendarDays,
  CheckCircle2,
  Clock,
  CloudSun,
  Cpu,
  Droplets,
  Moon,
  Plus,
  RefreshCcw,
  Save,
  Server,
  Settings,
  Sun,
  Thermometer,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import "./ControlPanel.css";

const API_BASE = window.location.port === "5173" ? "http://127.0.0.1:3000" : "";
const ADMIN_TOKEN_STORAGE_KEY = "my-terminal.adminToken";
const THEME_STORAGE_KEY = "my-terminal.theme";
const CALENDAR_COLORS = [
  { name: "Daniel", value: "#0000FF" },
  { name: "Alfonso", value: "#FF0000" },
  { name: "Raquel", value: "#00FF00" },
  { name: "Ángel", value: "#FFFF00" },
];

const emptyDashboard = {
  sensors: {
    batteryPercent: null,
    temperatureC: null,
    humidityPercent: null,
    rssi: null,
    updatedAt: null,
  },
  deviceStatus: {
    firmwareVersion: "",
    lastSeenAt: "",
    lastRefreshAttemptAt: "",
    lastScreenRefreshAt: "",
    screenRefreshStatus: "unknown",
    refreshReason: "",
    lastError: "",
    otaStatus: "",
    otaVersion: "",
    otaUpdatedAt: "",
  },
  settings: {
    deviceId: "",
    refreshHours: [],
    mqttHost: "",
    mqttPort: 1883,
    mqttUsername: "",
    mqttPassword: "",
    mqttBaseTopic: "",
    serverUrl: "",
    screenUrl: "",
    timezone: "Europe/Madrid",
    timezoneOptions: [],
  },
  calendars: [],
  firmwareReleases: [],
  eventExceptions: [],
  weatherLocation: {
    label: "",
    country: "",
    latitude: "",
    longitude: "",
    units: "metric",
    temperatureUnit: "celsius",
    windUnit: "ms",
    openWeatherApiKey: "",
    hasOpenWeatherApiKey: false,
  },
};

const emptyFirmwareForm = {
  version: "",
  file: null,
  notes: "",
  mandatory: false,
};

export default function ControlPanel() {
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [settings, setSettings] = useState(emptyDashboard.settings);
  const [calendars, setCalendars] = useState([]);
  const [weatherLocation, setWeatherLocation] = useState(emptyDashboard.weatherLocation);
  const [firmwareForm, setFirmwareForm] = useState(emptyFirmwareForm);
  const [theme, setTheme] = useState(getStoredTheme);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [testingWeather, setTestingWeather] = useState(false);
  const [weatherTest, setWeatherTest] = useState(null);
  const [testingCalendars, setTestingCalendars] = useState(false);
  const [calendarTest, setCalendarTest] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_error) {
      // localStorage can be unavailable in private browsing contexts.
    }
  }, [theme]);

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      const data = await api("/api/dashboard");
      applyDashboard(data);
      setNotice("Datos cargados");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  function applyDashboard(data) {
    const next = { ...emptyDashboard, ...data };
    setDashboard(next);
    setSettings(next.settings);
    setCalendars(assignCalendarColors(next.calendars));
    setWeatherLocation({
      ...emptyDashboard.weatherLocation,
      ...next.weatherLocation,
      openWeatherApiKey: "",
    });
  }

  async function uploadFirmwareRelease() {
    if (!firmwareForm.file || !firmwareForm.version.trim()) {
      setError("Selecciona un binario y una version");
      return;
    }

    setSaving("firmware");
    setError("");

    try {
      const contentBase64 = await readFileAsBase64(firmwareForm.file);
      const data = await api("/api/firmware/releases", {
        method: "POST",
        body: JSON.stringify({
          version: firmwareForm.version,
          filename: firmwareForm.file.name,
          contentBase64,
          notes: firmwareForm.notes,
          mandatory: firmwareForm.mandatory,
        }),
      });

      setDashboard((current) => ({
        ...current,
        firmwareReleases: [data, ...(current.firmwareReleases || [])].slice(0, 12),
      }));
      setFirmwareForm(emptyFirmwareForm);
      setNotice("Firmware OTA publicado");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving("");
    }
  }

  async function saveSettings() {
    await save("settings", "/api/device/settings", settings, (data) => {
      setDashboard((current) => ({ ...current, settings: data }));
      setSettings(data);
    });
  }

  async function saveCalendars() {
    await save("calendars", "/api/calendars", { calendars: assignCalendarColors(calendars) }, (data) => {
      setDashboard((current) => ({ ...current, calendars: data }));
      setCalendars(assignCalendarColors(data));
      setCalendarTest(null);
    });
  }

  async function saveWeatherLocation() {
    await save("weather", "/api/weather/location", weatherLocation, (data) => {
      setDashboard((current) => ({ ...current, weatherLocation: data }));
      setWeatherLocation({ ...data, openWeatherApiKey: "" });
      setWeatherTest(null);
    });
  }

  async function testWeather() {
    setTestingWeather(true);
    setError("");

    try {
      const data = await api("/api/weather/test", {
        method: "POST",
        body: JSON.stringify(weatherLocation),
      });
      setWeatherTest(data);
      setNotice(data.ok ? "Meteorologia OK" : "Meteorologia con error");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setTestingWeather(false);
    }
  }

  async function clearWeatherApiKey() {
    await save(
      "weather",
      "/api/weather/location",
      {
        ...weatherLocation,
        openWeatherApiKey: "",
        clearOpenWeatherApiKey: true,
      },
      (data) => {
        setDashboard((current) => ({ ...current, weatherLocation: data }));
        setWeatherLocation({ ...data, openWeatherApiKey: "" });
        setWeatherTest(null);
      },
    );
  }

  async function testCalendars() {
    setTestingCalendars(true);
    setError("");

    try {
      const data = await api("/api/calendars/test", {
        method: "POST",
        body: JSON.stringify({
          calendars: assignCalendarColors(calendars),
        }),
      });
      setCalendarTest(data);
      setNotice(data.ok ? "Calendarios OK" : "Calendarios con error");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setTestingCalendars(false);
    }
  }

  async function save(section, endpoint, payload, onSuccess) {
    setSaving(section);
    setError("");

    try {
      const data = await api(endpoint, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      onSuccess(data);
      setNotice("Cambios guardados");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving("");
    }
  }

  function updateSetting(field, value) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateRefreshHour(index, value) {
    setSettings((current) => ({
      ...current,
      refreshHours: current.refreshHours.map((hour, hourIndex) =>
        hourIndex === index ? value : hour,
      ),
    }));
  }

  function addRefreshHour() {
    setSettings((current) => ({
      ...current,
      refreshHours: [...current.refreshHours, "08:00"].slice(0, 12),
    }));
  }

  function removeRefreshHour(index) {
    setSettings((current) => ({
      ...current,
      refreshHours: current.refreshHours.filter((_hour, hourIndex) => hourIndex !== index),
    }));
  }

  function updateCalendar(index, field, value) {
    setCalendars((current) =>
      current.map((calendar, calendarIndex) =>
        calendarIndex === index ? { ...calendar, [field]: value } : calendar,
      ),
    );
  }

  function addCalendar() {
    if (calendars.length >= 4) {
      return;
    }

    const id =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : `calendar-${Date.now()}`;

    setCalendars((current) => [
      ...current,
      {
        id,
        position: current.length,
        name: `Calendario ${current.length + 1}`,
        url: "",
        color: CALENDAR_COLORS[current.length]?.value || "#000000",
        excludedKeywords: [],
        enabled: true,
      },
    ]);
  }

  function removeCalendar(index) {
    setCalendars((current) =>
      current
        .filter((_calendar, calendarIndex) => calendarIndex !== index)
        .map((calendar, position) => ({ ...calendar, position })),
    );
  }

  function updateWeatherLocation(field, value) {
    setWeatherLocation((current) => ({
      ...current,
      [field]: value,
    }));
  }

  const sensorUpdatedAt = formatDateTime(dashboard.sensors.updatedAt);
  const deviceStatus = { ...emptyDashboard.deviceStatus, ...(dashboard.deviceStatus || {}) };
  const latestFirmware = (dashboard.firmwareReleases || [])[0];

  return (
    <main className="control-shell" data-theme={theme}>
      <header className="control-header">
        <div>
          <p className="control-kicker">Seeed Studio E1002</p>
          <h1>Panel de control</h1>
        </div>
        <div className="control-actions">
          <StatusPill loading={loading} saving={saving} notice={notice} error={error} />
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Claro" : "Oscuro"}
          </button>
          <button className="icon-button" type="button" onClick={loadDashboard} title="Recargar">
            <RefreshCcw size={18} />
            Recargar
          </button>
        </div>
      </header>

      <section className="device-status-row" aria-label="Estado del dispositivo">
        <StatusMetric
          icon={Clock}
          label="Ultima lectura"
          value={sensorUpdatedAt}
          detail="Sensores recibidos"
        />
        <StatusMetric
          icon={Activity}
          label="Ultimo refresco"
          value={formatDateTime(deviceStatus.lastScreenRefreshAt)}
          detail={formatRefreshStatus(deviceStatus)}
        />
        <StatusMetric
          icon={Cpu}
          label="Firmware"
          value={deviceStatus.firmwareVersion || "--"}
          detail={formatOtaStatus(deviceStatus)}
        />
        <StatusMetric
          icon={Upload}
          label="OTA publicada"
          value={latestFirmware?.version || "--"}
          detail={
            latestFirmware
              ? `${formatBytes(latestFirmware.size)} · ${shortHash(latestFirmware.sha256)}`
              : "Sin release activo"
          }
        />
      </section>

      <section className="sensor-grid" aria-label="Sensores del dispositivo">
        <SensorMetric
          icon={Battery}
          label="Bateria"
          value={formatPercent(dashboard.sensors.batteryPercent)}
        />
        <SensorMetric
          icon={Thermometer}
          label="Temperatura"
          value={formatDegrees(dashboard.sensors.temperatureC)}
        />
        <SensorMetric
          icon={Droplets}
          label="Humedad"
          value={formatPercent(dashboard.sensors.humidityPercent)}
        />
        <SensorMetric
          icon={Wifi}
          label="RSSI"
          value={formatRssi(dashboard.sensors.rssi)}
        />
      </section>

      <div className="control-grid">
        <section className="control-section control-section--full calendar-section">
          <SectionHeader
            icon={Settings}
            title="Dispositivo"
            action={
              <SaveButton
                busy={saving === "settings"}
                label="Guardar"
                onClick={saveSettings}
              />
            }
          />

          <div className="settings-layout">
            <div className="field-grid field-grid--device">
              <TextField
                label="ID del dispositivo"
                value={settings.deviceId}
                onChange={(value) => updateSetting("deviceId", value)}
              />
              <TextField
                label="Servidor backend"
                value={settings.serverUrl}
                placeholder="http://192.168.1.50:3000"
                onChange={(value) => updateSetting("serverUrl", value)}
              />
              <TimezoneField
                value={settings.timezone}
                options={settings.timezoneOptions}
                onChange={(value) => updateSetting("timezone", value)}
              />
            </div>

            <div className="time-editor">
              <div className="subheader">
                <span>
                  <Clock size={16} />
                  Horas de actualizacion
                </span>
                <button
                  className="icon-only"
                  type="button"
                  onClick={addRefreshHour}
                  disabled={settings.refreshHours.length >= 12}
                  title="Añadir hora"
                >
                  <Plus size={17} />
                </button>
              </div>

              <div className="time-list">
                {settings.refreshHours.map((hour, index) => (
                  <div className="time-row" key={`${hour}-${index}`}>
                    <input
                      type="time"
                      value={hour}
                      aria-label={`Hora de actualizacion ${index + 1}`}
                      onChange={(event) => updateRefreshHour(index, event.target.value)}
                    />
                    <button
                      className="icon-only"
                      type="button"
                      onClick={() => removeRefreshHour(index)}
                      title={`Eliminar ${hour}`}
                      aria-label={`Eliminar hora ${hour}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mqtt-panel">
              <div className="subheader">
                <span>
                  <Server size={16} />
                  MQTT
                </span>
              </div>
              <div className="field-grid field-grid--mqtt">
                <TextField
                  label="Servidor"
                  value={settings.mqttHost}
                  onChange={(value) => updateSetting("mqttHost", value)}
                />
                <NumberField
                  label="Puerto"
                  value={settings.mqttPort}
                  onChange={(value) => updateSetting("mqttPort", value)}
                />
                <TextField
                  label="Topic base"
                  value={settings.mqttBaseTopic}
                  onChange={(value) => updateSetting("mqttBaseTopic", value)}
                />
                <TextField
                  label="Usuario"
                  value={settings.mqttUsername}
                  onChange={(value) => updateSetting("mqttUsername", value)}
                />
                <PasswordField
                  label="Password"
                  value={settings.mqttPassword}
                  onChange={(value) => updateSetting("mqttPassword", value)}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="control-section">
          <SectionHeader
            icon={Upload}
            title="Firmware OTA"
            action={
              <SaveButton
                busy={saving === "firmware"}
                disabled={!firmwareForm.file || !firmwareForm.version.trim()}
                label="Publicar"
                onClick={uploadFirmwareRelease}
              />
            }
          />

          <div className="firmware-panel">
            <div className="firmware-current">
              <span>Release activo</span>
              <strong>{latestFirmware?.version || "--"}</strong>
              <small>
                {latestFirmware
                  ? `${formatDateTime(latestFirmware.createdAt)} · ${formatBytes(latestFirmware.size)}`
                  : "No hay binario publicado"}
              </small>
            </div>

            <div className="firmware-grid">
              <TextField
                label="Version"
                value={firmwareForm.version}
                placeholder="1.0.0"
                onChange={(value) =>
                  setFirmwareForm((current) => ({ ...current, version: value }))
                }
              />
              <label className="field file-field">
                <span>Binario .bin</span>
                <input
                  key={firmwareForm.file ? firmwareForm.file.name : "empty-file"}
                  type="file"
                  accept=".bin,application/octet-stream"
                  onChange={(event) =>
                    setFirmwareForm((current) => ({
                      ...current,
                      file: event.target.files?.[0] || null,
                    }))
                  }
                />
              </label>
              <label className="switch-row firmware-mandatory">
                <input
                  type="checkbox"
                  checked={firmwareForm.mandatory}
                  onChange={(event) =>
                    setFirmwareForm((current) => ({
                      ...current,
                      mandatory: event.target.checked,
                    }))
                  }
                />
                Obligatoria
              </label>
              <label className="field field--textarea field--full firmware-notes">
                <span>Notas</span>
                <textarea
                  value={firmwareForm.notes}
                  onChange={(event) =>
                    setFirmwareForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Cambios incluidos en esta version"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="control-section">
          <SectionHeader
            icon={CloudSun}
            title="Meteorologia"
            action={
              <div className="button-row">
                <button
                  className="icon-button"
                  type="button"
                  onClick={testWeather}
                  disabled={testingWeather}
                >
                  <CloudSun size={16} />
                  {testingWeather ? "Probando" : "Probar"}
                </button>
                <SaveButton
                  busy={saving === "weather"}
                  label="Guardar"
                  onClick={saveWeatherLocation}
                />
              </div>
            }
          />

          <div className="location-grid">
            <TextField
              label="Ubicacion"
              value={weatherLocation.label}
              onChange={(value) => updateWeatherLocation("label", value)}
            />
            <TextField
              label="Pais"
              value={weatherLocation.country}
              onChange={(value) => updateWeatherLocation("country", value)}
              maxLength={2}
            />
            <NumberField
              label="Latitud"
              value={weatherLocation.latitude ?? ""}
              onChange={(value) => updateWeatherLocation("latitude", value)}
              step="0.0001"
            />
            <NumberField
              label="Longitud"
              value={weatherLocation.longitude ?? ""}
              onChange={(value) => updateWeatherLocation("longitude", value)}
              step="0.0001"
            />
            <label className="field">
              <span>Temperatura</span>
              <select
                value={weatherLocation.temperatureUnit || "celsius"}
                onChange={(event) =>
                  updateWeatherLocation("temperatureUnit", event.target.value)
                }
              >
                <option value="celsius">Celsius</option>
                <option value="fahrenheit">Fahrenheit</option>
                <option value="kelvin">Kelvin</option>
              </select>
            </label>
            <label className="field">
              <span>Viento</span>
              <select
                value={weatherLocation.windUnit || "ms"}
                onChange={(event) => updateWeatherLocation("windUnit", event.target.value)}
              >
                <option value="ms">m/s</option>
                <option value="kmh">km/h</option>
                <option value="mph">mph</option>
              </select>
            </label>
            <PasswordField
              className="field--full"
              label="OpenWeather API key"
              value={weatherLocation.openWeatherApiKey || ""}
              placeholder={weatherLocation.hasOpenWeatherApiKey ? "Configurada" : ""}
              onChange={(value) => updateWeatherLocation("openWeatherApiKey", value)}
            />
            {weatherLocation.hasOpenWeatherApiKey ? (
              <button
                className="icon-button field--full"
                type="button"
                onClick={clearWeatherApiKey}
                disabled={saving === "weather"}
              >
                Borrar key guardada
              </button>
            ) : null}
          </div>
          {weatherTest ? (
            <p
              className={[
                "weather-test",
                weatherTest.ok ? "weather-test--ok" : "weather-test--error",
              ].join(" ")}
            >
              {formatWeatherTest(weatherTest)}
            </p>
          ) : null}
        </section>

        <section className="control-section control-section--wide">
          <SectionHeader
            icon={CalendarDays}
            title={`Calendarios ICS (${calendars.length}/4)`}
            action={
              <div className="button-row">
                <button
                  className="icon-button"
                  type="button"
                  onClick={addCalendar}
                  disabled={calendars.length >= 4}
                >
                  <Plus size={16} />
                  Añadir
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={testCalendars}
                  disabled={testingCalendars}
                >
                  <CalendarDays size={16} />
                  {testingCalendars ? "Probando" : "Probar"}
                </button>
                <SaveButton
                  busy={saving === "calendars"}
                  label="Guardar"
                  onClick={saveCalendars}
                />
              </div>
            }
          />

          <div className="calendar-editor">
            {calendars.map((calendar, index) => (
              <div className="calendar-row" key={calendar.id}>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={calendar.enabled}
                    onChange={(event) =>
                      updateCalendar(index, "enabled", event.target.checked)
                    }
                  />
                  Activo
                </label>
                <TextField
                  label="Nombre"
                  value={calendar.name}
                  onChange={(value) => updateCalendar(index, "name", value)}
                />
                <TextField
                  label="URL ICS"
                  value={calendar.url}
                  onChange={(value) => updateCalendar(index, "url", value)}
                />
                <KeywordField
                  value={calendar.excludedKeywords || []}
                  onChange={(value) => updateCalendar(index, "excludedKeywords", value)}
                />
                <CalendarColorBadge color={calendar.color} owner={calendar.name} />
                <button
                  className="icon-only calendar-delete"
                  type="button"
                  onClick={() => removeCalendar(index)}
                  title="Eliminar calendario"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
          {calendarTest ? <CalendarTestResult result={calendarTest} /> : null}
        </section>
      </div>
    </main>
  );
}

function SectionHeader({ icon: Icon, title, action }) {
  return (
    <header className="section-header">
      <h2>
        <Icon size={19} />
        {title}
      </h2>
      {action}
    </header>
  );
}

function SensorMetric({ icon: Icon, label, value, detail }) {
  return (
    <article className="sensor-card">
      <Icon size={22} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function StatusMetric({ icon: Icon, label, value, detail }) {
  return (
    <article className="status-card">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function CalendarTestResult({ result }) {
  const calendars = result.calendars || [];

  return (
    <div
      className={[
        "calendar-test",
        result.ok ? "calendar-test--ok" : "calendar-test--error",
      ].join(" ")}
    >
      <strong>{result.ok ? "Calendarios OK" : "Calendarios con error"}</strong>
      <span>
        {result.checked || 0} comprobados · {result.failed || 0} con error
      </span>
      <ul>
        {calendars.map((calendar, index) => (
          <li key={`${calendar.name}-${index}`}>
            <b>{calendar.name}</b>
            <span>{formatCalendarDiagnostic(calendar)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TextField({ label, value, onChange, maxLength, placeholder = "" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={value || ""}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PasswordField({ className = "", label, value, onChange, placeholder = "" }) {
  return (
    <label className={["field", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <input
        type="password"
        value={value || ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function KeywordField({ value, onChange }) {
  return (
    <label className="field calendar-keywords">
      <span>Filtros</span>
      <textarea
        value={(value || []).join("\n")}
        placeholder={"privado\ncancelado"}
        onChange={(event) => onChange(parseKeywords(event.target.value))}
      />
    </label>
  );
}

function NumberField({ label, value, onChange, step = "1" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TimezoneField({ value, options, onChange }) {
  const timezoneOptions = options?.length
    ? options
    : [{ id: "Europe/Madrid", label: "Madrid / Peninsula" }];

  return (
    <label className="field">
      <span>Zona horaria</span>
      <select
        value={value || "Europe/Madrid"}
        onChange={(event) => onChange(event.target.value)}
      >
        {timezoneOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CalendarColorBadge({ color, owner }) {
  return (
    <div className="calendar-color">
      <span>Color</span>
      <strong>
        <i style={{ "--swatch": color }} />
        {owner || "Calendario"}
      </strong>
    </div>
  );
}

function SaveButton({ busy, disabled = false, label, onClick }) {
  return (
    <button
      className="icon-button icon-button--primary"
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
    >
      <Save size={16} />
      {busy ? "Guardando" : label}
    </button>
  );
}

function StatusPill({ loading, saving, notice, error }) {
  if (error) {
    return <span className="status-pill status-pill--error">{error}</span>;
  }

  if (loading) {
    return <span className="status-pill">Cargando</span>;
  }

  if (saving) {
    return <span className="status-pill">Guardando</span>;
  }

  if (notice) {
    return (
      <span className="status-pill status-pill--ok">
        <CheckCircle2 size={14} />
        {notice}
      </span>
    );
  }

  return null;
}

async function api(endpoint, options = {}, retryAuth = true) {
  const { headers = {}, ...requestOptions } = options;
  const adminToken = getStoredAdminToken();
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
      ...headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (response.status === 401 && retryAuth) {
    const nextToken = window.prompt("Token de administrador");
    if (nextToken) {
      window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, nextToken.trim());
      return api(endpoint, options, false);
    }
  }

  if (!response.ok) {
    throw new Error(data?.message || `HTTP ${response.status}`);
  }

  return data;
}

function getStoredAdminToken() {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
  } catch (_error) {
    return "";
  }
}

function getStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch (_error) {
    return "dark";
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el binario"));
    reader.readAsDataURL(file);
  });
}

function formatPercent(value) {
  return value === null || value === undefined ? "--" : `${Math.round(value)}%`;
}

function formatDegrees(value) {
  return value === null || value === undefined ? "--" : `${Number(value).toFixed(1)}°C`;
}

function formatRssi(value) {
  return value === null || value === undefined ? "--" : `${Math.round(value)} dBm`;
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRefreshStatus(status) {
  if (status.screenRefreshStatus === "success") {
    return status.refreshReason ? `OK · ${status.refreshReason}` : "OK";
  }

  if (status.screenRefreshStatus === "error") {
    return status.lastError ? `Error · ${status.lastError}` : "Error";
  }

  return "Sin refresco reportado";
}

function formatOtaStatus(status) {
  if (!status.otaStatus) {
    return status.lastSeenAt ? `Visto ${formatDateTime(status.lastSeenAt)}` : "Sin conexion reportada";
  }

  return status.otaVersion
    ? `${status.otaStatus} · ${status.otaVersion}`
    : status.otaStatus;
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "--";
  }

  if (number < 1024 * 1024) {
    return `${Math.round(number / 1024)} KB`;
  }

  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(value) {
  const hash = String(value || "");
  return hash ? hash.slice(0, 8) : "--";
}

function parseKeywords(value) {
  return [...new Set(
    String(value || "")
      .split(/\r?\n|,/)
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  )].slice(0, 40);
}

function formatWeatherTest(result) {
  if (!result) {
    return "";
  }

  const source = result.apiKeySource === "stored" ? "panel" : result.apiKeySource === "env" ? ".env" : "sin key";

  if (!result.ok) {
    return `${source}: ${result.message || result.reason || "error"}`;
  }

  const current = result.current || {};
  return `${source}: ${current.city || "OK"} ${formatWeatherTemperature(current.temp, current.unitSuffix)}, viento ${formatWind(current.wind, current.windUnit)}`;
}

function formatCalendarDiagnostic(calendar) {
  const next = (calendar.nextEvents || [])[0];
  const suffix = next
    ? ` · proximo: ${next.allDay ? "todo el dia" : formatDateTime(next.startsAt)} ${next.title}`
    : "";

  return `${calendar.message || calendar.status || "sin datos"}${suffix}`;
}

function formatWind(value, unit = "m/s") {
  return value === null || value === undefined ? "--" : `${Math.round(value)} ${unit}`;
}

function formatWeatherTemperature(value, unitSuffix = "C") {
  if (value === null || value === undefined) {
    return "--";
  }

  return unitSuffix === "K" ? `${Math.round(value)}K` : `${Math.round(value)}°${unitSuffix}`;
}

function assignCalendarColors(calendars) {
  return (calendars || []).slice(0, 4).map((calendar, index) => ({
    ...calendar,
    position: index,
    color: CALENDAR_COLORS[index]?.value || "#000000",
    excludedKeywords: parseKeywords(
      Array.isArray(calendar.excludedKeywords)
        ? calendar.excludedKeywords.join("\n")
        : calendar.excludedKeywords,
    ),
  }));
}
