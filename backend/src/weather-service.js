const { createHash } = require("node:crypto");
const { getCacheEntry, setCacheEntry } = require("./database");
const { toDateKey } = require("./date-utils");

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

async function getWeatherData(location) {
  const fallback = getFallbackWeather(location);
  const apiKey = location.openWeatherApiKey || process.env.OPENWEATHER_API_KEY;

  if (!apiKey || !location.latitude || !location.longitude) {
    return fallback;
  }

  const lat = Number(location.latitude);
  const lon = Number(location.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return fallback;
  }

  const units = location.units || "metric";
  const cacheKey = `weather:${lat.toFixed(4)}:${lon.toFixed(4)}:${units}:${hash(apiKey)}`;
  const cached = getCacheEntry(cacheKey);

  if (cached) {
    return ensureWeatherUnits(cached, units);
  }

  try {
    const [current, forecast] = await Promise.all([
      fetchOpenWeather("weather", lat, lon, units, apiKey),
      fetchOpenWeather("forecast", lat, lon, units, apiKey),
    ]);
    const data = normalizeWeather(current, forecast, location, units);

    return setCacheEntry(cacheKey, data, WEATHER_CACHE_TTL_MS);
  } catch (error) {
    console.error("Could not read OpenWeather:", error);
    return fallback;
  }
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
      throw new Error(`OpenWeather ${endpoint} failed with HTTP ${response.status}`);
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
  const unitSuffix = units === "imperial" ? "F" : units === "standard" ? "K" : "C";
  const windUnit = units === "imperial" ? "mph" : "m/s";

  return {
    current: {
      city: current.name || location.label || "Ubicacion",
      temp: round(current.main?.temp),
      condition: mapWeatherCondition(currentCondition.id),
      summary: capitalize(currentCondition.description || "Sin datos"),
      high: round(todayForecast.high ?? current.main?.temp_max),
      low: round(todayForecast.low ?? current.main?.temp_min),
      feelsLike: round(current.main?.feels_like),
      humidity: round(current.main?.humidity),
      wind: round(current.wind?.speed),
      windUnit,
      rainChance: round(todayForecast.rainChance),
      unitSuffix,
    },
    forecastByDate,
  };
}

function ensureWeatherUnits(data, units) {
  return {
    ...data,
    current: {
      ...(data.current || {}),
      windUnit: data.current?.windUnit || windUnitFor(units),
      unitSuffix: data.current?.unitSuffix || unitSuffixFor(units),
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
      unitSuffix: units === "imperial" ? "F" : units === "standard" ? "K" : "C",
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
      windUnit: windUnitFor(location.units),
      rainChance: null,
      unitSuffix: unitSuffixFor(location.units),
    },
    forecastByDate: {},
  };
}

function unitSuffixFor(units) {
  if (units === "imperial") {
    return "F";
  }

  if (units === "standard") {
    return "K";
  }

  return "C";
}

function windUnitFor(units) {
  return units === "imperial" ? "mph" : "m/s";
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

module.exports = {
  getWeatherData,
};
