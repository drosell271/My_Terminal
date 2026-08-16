const { createHash } = require("node:crypto");
const { getCacheEntry, setCacheEntry } = require("./database");
const { toDateKey } = require("./date-utils");

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

async function getWeatherData(location) {
  const fallback = getFallbackWeather(location);
  const config = buildWeatherRequestConfig(location);

  if (!config.ok) {
    return fallback;
  }

  const cacheKey = [
    "weather",
    config.lat.toFixed(4),
    config.lon.toFixed(4),
    config.temperatureUnit,
    config.windUnit,
    hash(config.apiKey),
  ].join(":");
  const cached = getCacheEntry(cacheKey);

  if (cached) {
    return ensureWeatherUnits(cached, config.temperatureUnit, config.windUnit);
  }

  try {
    const [current, forecast] = await Promise.all([
      fetchOpenWeather("weather", config.lat, config.lon, config.openWeatherUnits, config.apiKey),
      fetchOpenWeather("forecast", config.lat, config.lon, config.openWeatherUnits, config.apiKey),
    ]);
    const data = normalizeWeather(current, forecast, location, {
      temperatureUnit: config.temperatureUnit,
      windUnit: config.windUnit,
      openWeatherUnits: config.openWeatherUnits,
    });

    return setCacheEntry(cacheKey, data, WEATHER_CACHE_TTL_MS);
  } catch (error) {
    console.error("Could not read OpenWeather:", describeError(error));
    return fallback;
  }
}

async function getWeatherDiagnostics(location) {
  const config = buildWeatherRequestConfig(location);

  if (!config.ok) {
    return {
      ok: false,
      reason: config.reason,
      message: config.message,
      apiKeySource: config.apiKeySource,
      hasCoordinates: Boolean(config.hasCoordinates),
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const [current, forecast] = await Promise.all([
      fetchOpenWeather("weather", config.lat, config.lon, config.openWeatherUnits, config.apiKey),
      fetchOpenWeather("forecast", config.lat, config.lon, config.openWeatherUnits, config.apiKey),
    ]);
    const normalized = normalizeWeather(current, forecast, location, {
      temperatureUnit: config.temperatureUnit,
      windUnit: config.windUnit,
      openWeatherUnits: config.openWeatherUnits,
    });

    return {
      ok: true,
      apiKeySource: config.apiKeySource,
      checkedAt: new Date().toISOString(),
      current: normalized.current,
      forecastDays: Object.keys(normalized.forecastByDate).length,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "OPENWEATHER_ERROR",
      message: describeError(error),
      apiKeySource: config.apiKeySource,
      checkedAt: new Date().toISOString(),
    };
  }
}

function buildWeatherRequestConfig(location) {
  const storedApiKey = String(location.openWeatherApiKey || "").trim();
  const envApiKey = String(process.env.OPENWEATHER_API_KEY || "").trim();
  const apiKey = storedApiKey || envApiKey;
  const lat = parseCoordinate(location.latitude);
  const lon = parseCoordinate(location.longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const temperatureUnit = normalizeTemperatureUnit(location.temperatureUnit, location.units);
  const windUnit = normalizeWindUnit(location.windUnit, location.units);
  const openWeatherUnits = openWeatherUnitsForTemperature(temperatureUnit);

  if (!apiKey) {
    return {
      ok: false,
      reason: "MISSING_API_KEY",
      message: "No hay API key de OpenWeather configurada",
      apiKeySource: "none",
      hasCoordinates,
    };
  }

  if (!hasCoordinates) {
    return {
      ok: false,
      reason: "INVALID_COORDINATES",
      message: "Latitud o longitud no validas",
      apiKeySource: storedApiKey ? "stored" : "env",
      hasCoordinates: false,
    };
  }

  return {
    ok: true,
    apiKey,
    apiKeySource: storedApiKey ? "stored" : "env",
    lat,
    lon,
    hasCoordinates,
    temperatureUnit,
    windUnit,
    openWeatherUnits,
  };
}

async function fetchOpenWeather(endpoint, lat, lon, units, apiKey) {
  const url = new URL(`https://api.openweathermap.org/data/2.5/${endpoint}`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", units);
  url.searchParams.set("lang", "es");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "eink-dashboard/0.1",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenWeather ${endpoint} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWeather(current, forecast, location, units) {
  const forecastByDate = buildForecastByDate(forecast, units);
  const todayKey = toDateKey(new Date());
  const todayForecast = forecastByDate[todayKey] || {};
  const currentCondition = current.weather?.[0] || {};
  const unitSuffix = unitSuffixFor(units.temperatureUnit);
  const sourceWindUnit = windUnitForOpenWeather(units.openWeatherUnits);

  return {
    current: {
      city: location.label || current.name || "Ubicacion",
      temp: round(current.main?.temp),
      condition: mapWeatherCondition(currentCondition.id),
      summary: capitalize(currentCondition.description || "Sin datos"),
      high: round(todayForecast.high ?? current.main?.temp_max),
      low: round(todayForecast.low ?? current.main?.temp_min),
      feelsLike: round(current.main?.feels_like),
      humidity: round(current.main?.humidity),
      wind: round(convertWind(current.wind?.speed, sourceWindUnit, units.windUnit)),
      windUnit: windLabelFor(units.windUnit),
      rainChance: round(todayForecast.rainChance),
      unitSuffix,
    },
    forecastByDate,
  };
}

function ensureWeatherUnits(data, temperatureUnit, windUnit) {
  return {
    ...data,
    current: {
      ...(data.current || {}),
      windUnit: data.current?.windUnit || windLabelFor(windUnit),
      unitSuffix: data.current?.unitSuffix || unitSuffixFor(temperatureUnit),
    },
  };
}

function buildForecastByDate(forecast, units) {
  const grouped = {};

  for (const item of forecast.list || []) {
    const date = new Date((item.dt || 0) * 1000);
    const key = toDateKey(date);
    const bucket = grouped[key] || {
      temps: [],
      pops: [],
      entries: [],
      unitSuffix: unitSuffixFor(units.temperatureUnit),
    };

    bucket.temps.push(item.main?.temp);
    bucket.pops.push((item.pop || 0) * 100);
    bucket.entries.push({
      hour: date.getHours(),
      condition: mapWeatherCondition(item.weather?.[0]?.id),
    });
    grouped[key] = bucket;
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([dateKey, bucket]) => {
      const temps = bucket.temps.filter(Number.isFinite);
      const pops = bucket.pops.filter(Number.isFinite);

      return [
        dateKey,
        {
          condition: pickDayCondition(bucket.entries),
          high: temps.length ? round(Math.max(...temps)) : null,
          low: temps.length ? round(Math.min(...temps)) : null,
          rainChance: pops.length ? round(Math.max(...pops)) : null,
          unitSuffix: bucket.unitSuffix,
        },
      ];
    }),
  );
}

function pickDayCondition(entries) {
  if (!entries.length) {
    return "cloud";
  }

  const noon = entries.reduce((best, entry) =>
    Math.abs(entry.hour - 12) < Math.abs(best.hour - 12) ? entry : best,
  );

  return noon.condition;
}

function mapWeatherCondition(id) {
  if (id >= 200 && id < 300) {
    return "storm";
  }

  if (id >= 300 && id < 400) {
    return "drizzle";
  }

  if (id >= 500 && id < 600) {
    return "rain";
  }

  if (id >= 600 && id < 700) {
    return "snow";
  }

  if (id >= 700 && id < 800) {
    return "fog";
  }

  if (id === 800) {
    return "sun";
  }

  if (id === 801) {
    return "partly";
  }

  return "cloud";
}

function getFallbackWeather(location) {
  const temperatureUnit = normalizeTemperatureUnit(location.temperatureUnit, location.units);
  const windUnit = normalizeWindUnit(location.windUnit, location.units);

  return {
    current: {
      city: location.label || "Ubicacion",
      temp: null,
      condition: "cloud",
      summary: "Sin datos",
      high: null,
      low: null,
      feelsLike: null,
      humidity: null,
      wind: null,
      windUnit: windLabelFor(windUnit),
      rainChance: null,
      unitSuffix: unitSuffixFor(temperatureUnit),
    },
    forecastByDate: {},
  };
}

function normalizeTemperatureUnit(value, legacyUnits) {
  const unit = String(value || "").trim().toLowerCase();
  if (["celsius", "fahrenheit", "kelvin"].includes(unit)) {
    return unit;
  }

  if (legacyUnits === "imperial") {
    return "fahrenheit";
  }

  if (legacyUnits === "standard") {
    return "kelvin";
  }

  return "celsius";
}

function normalizeWindUnit(value, legacyUnits) {
  const unit = String(value || "").trim().toLowerCase();
  if (["ms", "kmh", "mph"].includes(unit)) {
    return unit;
  }

  return legacyUnits === "imperial" ? "mph" : "ms";
}

function unitSuffixFor(temperatureUnit) {
  if (temperatureUnit === "fahrenheit") {
    return "F";
  }

  if (temperatureUnit === "kelvin") {
    return "K";
  }

  return "C";
}

function openWeatherUnitsForTemperature(temperatureUnit) {
  if (temperatureUnit === "fahrenheit") {
    return "imperial";
  }

  if (temperatureUnit === "kelvin") {
    return "standard";
  }

  return "metric";
}

function windUnitForOpenWeather(units) {
  return units === "imperial" ? "mph" : "ms";
}

function windLabelFor(windUnit) {
  if (windUnit === "kmh") {
    return "km/h";
  }

  if (windUnit === "mph") {
    return "mph";
  }

  return "m/s";
}

function convertWind(value, sourceUnit, targetUnit) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  const metersPerSecond = sourceUnit === "mph" ? number * 0.44704 : number;

  if (targetUnit === "kmh") {
    return metersPerSecond * 3.6;
  }

  if (targetUnit === "mph") {
    return metersPerSecond / 0.44704;
  }

  return metersPerSecond;
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function capitalize(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function hash(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function describeError(error) {
  const message = error?.message || String(error);
  const cause = error?.cause?.message ? `: ${error.cause.message}` : "";
  return `${message}${cause}`;
}

function parseCoordinate(value) {
  return Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
}

module.exports = {
  getWeatherData,
  getWeatherDiagnostics,
};
