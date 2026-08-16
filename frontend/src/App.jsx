import React, { useEffect, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Droplets,
  Sun,
  Thermometer,
  Umbrella,
  Wind,
} from "lucide-react";
import "./App.css";
import ControlPanel from "./ControlPanel.jsx";

const API_BASE = window.location.port === "5173" ? "http://127.0.0.1:3000" : "";
const ADMIN_TOKEN_STORAGE_KEY = "my-terminal.adminToken";

export default function App() {
  const path = window.location.pathname;

  if (path.startsWith("/control")) {
    return <ControlPanel />;
  }

  return <EinkScreen />;
}

function EinkScreen() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let ignore = false;

    fetch(`${API_BASE}/api/eink-data`, {
      headers: {
        Accept: "application/json",
        ...authHeaders(),
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      })
      .then((payload) => {
        if (!ignore) {
          setData(payload);
        }
      })
      .catch((requestError) => {
        if (!ignore) {
          console.error(requestError);
          setData(buildFallbackData());
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const screenData = data || buildFallbackData();
  const currentWeather = screenData.currentWeather || {};
  const timezone = screenData.timezone || "Europe/Madrid";
  const todayEvents = screenData.todayEvents || [];

  return (
    <main className="eink-screen" aria-label="Panel e-ink">
      <section className="month-panel" aria-label="Calendario mensual">
        <header className="month-header">
          <div>
            <p className="eyebrow">Calendario</p>
            <h1>{screenData.activeMonth.label}</h1>
          </div>
          <CalendarLegend calendars={screenData.calendars || []} />
        </header>

        <div className="weekday-grid" aria-hidden="true">
          {["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="month-grid">
          {(screenData.days || []).map((day) => (
            <article
              className={[
                "day-cell",
                day.isCurrentMonth ? "" : "day-cell--muted",
                day.isToday ? "day-cell--today" : "",
                day.isHoliday || day.isSunday ? "day-cell--red" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={day.dateKey}
              title={(day.holidays || []).join(", ")}
            >
              <div className="day-topline">
                <span className="day-number">{day.dayNumber}</span>
                {day.weatherCondition ? (
                  <WeatherGlyph type={day.weatherCondition} size="small" />
                ) : null}
              </div>

              <div
                className="event-dots"
                aria-label={`${(day.eventCalendars || []).length} calendarios`}
              >
                {(day.eventCalendars || []).slice(0, 4).map((calendar) => (
                  <span
                    className="event-dot"
                    key={calendar.id}
                    style={{ "--dot-color": calendar.color }}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="weather-panel" aria-label="Clima actual">
        <div className="weather-main">
          <div className="weather-copy">
            <p className="eyebrow">Clima actual</p>
            <h2>{currentWeather.city || "Ubicacion"}</h2>
            <p className="weather-summary">{currentWeather.summary || "Sin datos"}</p>
            <p className="weather-range">
              Max {formatWeatherValue(currentWeather.high, currentWeather.unitSuffix)} · Min{" "}
              {formatWeatherValue(currentWeather.low, currentWeather.unitSuffix)}
            </p>
          </div>

          <div className="weather-display">
            <WeatherGlyph type={currentWeather.condition || "cloud"} size="large" />
            <div className="temperature">
              <span>{formatPlainNumber(currentWeather.temp)}</span>
              <sup>{formatTemperatureSuffix(currentWeather.unitSuffix || "C")}</sup>
            </div>
          </div>
        </div>

        <div className="weather-metrics">
          <WeatherStat
            icon={Thermometer}
            label="Sens."
            value={formatWeatherValue(currentWeather.feelsLike, currentWeather.unitSuffix)}
          />
          <WeatherStat icon={Droplets} label="Hum." value={formatPercent(currentWeather.humidity)} />
          <WeatherStat
            icon={Wind}
            label="Viento"
            value={formatWind(currentWeather.wind, currentWeather.windUnit)}
          />
          <WeatherStat icon={Umbrella} label="Lluvia" value={formatPercent(currentWeather.rainChance)} />
        </div>
      </section>

      <section className="today-panel" aria-label="Eventos de hoy">
        <header className="today-header">
          <div>
            <p className="eyebrow">Hoy</p>
            <h2>{formatDayLabel(screenData.todayKey, timezone)}</h2>
          </div>
        </header>

        <div className="today-list">
          {todayEvents.slice(0, 5).map((event) => (
            <article
              className={[
                "today-event",
                event.allDay ? "today-event--all-day" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={event.id}
              style={{ "--event-color": event.calendarColor || "#000000" }}
            >
              <time dateTime={event.startsAt}>{formatEventTime(event, timezone)}</time>
              <div>
                <h3>{event.title}</h3>
              </div>
            </article>
          ))}
        </div>
      </section>

      <time className="refresh-stamp" dateTime={screenData.generatedAt}>
        {formatRefreshStamp(screenData.generatedAt, timezone)}
      </time>
    </main>
  );
}

function CalendarLegend({ calendars }) {
  return (
    <div className="calendar-legend" aria-label="Calendarios">
      {calendars.slice(0, 4).map((calendar) => (
        <span className="legend-item" key={calendar.id}>
          <span
            className="legend-swatch"
            style={{ "--dot-color": calendar.color }}
          />
          {calendar.name}
        </span>
      ))}
    </div>
  );
}

function authHeaders() {
  try {
    const adminToken = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    return adminToken ? { "X-Admin-Token": adminToken } : {};
  } catch (_error) {
    return {};
  }
}

function WeatherGlyph({ type, size }) {
  const icons = {
    sun: Sun,
    partly: Cloud,
    cloud: Cloud,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    storm: CloudLightning,
    snow: CloudSnow,
    fog: CloudFog,
    wind: Wind,
  };
  const Icon = icons[type] || Cloud;

  return (
    <Icon
      aria-hidden="true"
      className={`weather-icon weather-icon--${type} weather-icon--${size}`}
      strokeWidth={size === "large" ? 1.7 : 2.2}
    />
  );
}

function WeatherStat({ icon: Icon, label, value }) {
  return (
    <div className="weather-stat">
      <Icon aria-hidden="true" size={19} strokeWidth={2.2} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatEventTime(event, timezone) {
  if (event.allDay) {
    return "TODO DIA";
  }

  if (event.endsAt) {
    return `${formatTime(event.startsAt, timezone)}-${formatTime(event.endsAt, timezone)}`;
  }

  return formatTime(event.startsAt, timezone);
}

function formatRefreshStamp(dateString, timezone) {
  const date = new Date(dateString);
  const weekday = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    timeZone: timezone,
  })
    .format(date)
    .replace(".", "");
  const parts = dateParts(date, timezone, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${weekday} ${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

function formatDayLabel(dateKey, timezone) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(date);
}

function formatTime(dateString, timezone) {
  const date = new Date(dateString);
  const parts = dateParts(date, timezone, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${parts.hour}:${parts.minute}`;
}

function dateParts(date, timezone, options) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("es-ES", {
      ...options,
      hour12: false,
      timeZone: timezone,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function formatWeatherValue(value, unitSuffix = "C") {
  if (value === null || value === undefined) {
    return `--°`;
  }

  return `${Math.round(value)}${formatTemperatureSuffix(unitSuffix)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "--%";
  }

  return `${Math.round(value)}%`;
}

function formatPlainNumber(value) {
  if (value === null || value === undefined) {
    return "--";
  }

  return String(Math.round(value));
}

function formatWind(value, unit = "m/s") {
  if (value === null || value === undefined) {
    return "--";
  }

  return `${Math.round(value)}${unit}`;
}

function formatTemperatureSuffix(unitSuffix) {
  return unitSuffix === "K" ? "K" : `°${unitSuffix}`;
}

function buildFallbackData() {
  const today = new Date();
  const todayKey = toDateKey(today);
  const monthDays = buildFallbackMonthDays(today);

  return {
    generatedAt: today.toISOString(),
    timezone: "Europe/Madrid",
    todayKey,
    activeMonth: {
      offset: 0,
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      label: formatMonth(today),
    },
    calendars: [],
    currentWeather: {
      city: "Ubicacion",
      temp: null,
      condition: "cloud",
      summary: "Sin datos",
      high: null,
      low: null,
      feelsLike: null,
      humidity: null,
      wind: null,
      windUnit: "m/s",
      rainChance: null,
      unitSuffix: "C",
    },
    days: monthDays,
    todayEvents: [],
  };
}

function buildFallbackMonthDays(anchorDate) {
  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    1 - mondayOffset,
  );

  return Array.from({ length: 42 }, (_item, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      dateKey: toDateKey(date),
      dayNumber: date.getDate(),
      weekday: date.getDay(),
      isCurrentMonth: date.getMonth() === anchorDate.getMonth(),
      isToday: toDateKey(date) === toDateKey(anchorDate),
      isSunday: date.getDay() === 0,
      isHoliday: false,
      holidays: [],
      weatherCondition: null,
      eventCalendars: [],
    };
  });
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonth(date) {
  const month = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(date);

  return month.charAt(0).toUpperCase() + month.slice(1);
}
