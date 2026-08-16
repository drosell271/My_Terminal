const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.DB_FILE = path.join(
  os.tmpdir(),
  `my-terminal-test-${process.pid}-${Date.now()}.sqlite`,
);
process.env.PUBLIC_BASE_URL = "";

const {
  getSensors,
  getDeviceSettings,
  getWeatherLocation,
  saveWeatherLocation,
  saveDeviceSettings,
  normalizeServerUrl,
  normalizeStoredServerUrl,
} = require("./database");
const { getCalendarDiagnostics, parseIcsEvents } = require("./ics-service");

test("device settings do not publish loopback URLs by default", () => {
  const settings = getDeviceSettings();

  assert.equal(settings.serverUrl, "");
  assert.equal(settings.screenUrl, "");
  assert.equal(settings.timezone, "Europe/Madrid");
  assert.equal(settings.timezonePosix, "CET-1CEST,M3.5.0/2,M10.5.0/3");
  assert.equal(normalizeStoredServerUrl("http://127.0.0.1:3000/api/screen.bmp"), "");
  assert.equal(normalizeServerUrl("http://192.168.1.50:3000/api/screen.bmp"), "http://192.168.1.50:3000");
});

test("device timezone can be configured and falls back on invalid values", () => {
  const utcSettings = saveDeviceSettings({ timezone: "UTC" });
  assert.equal(utcSettings.timezone, "UTC");
  assert.equal(utcSettings.timezonePosix, "UTC0");

  const unchanged = saveDeviceSettings({ timezone: "Invalid/Timezone" });
  assert.equal(unchanged.timezone, "UTC");
  assert.equal(unchanged.timezonePosix, "UTC0");
});

test("sensor defaults start empty until the device posts a reading", () => {
  const sensors = getSensors();

  assert.equal(sensors.batteryPercent, null);
  assert.equal(sensors.temperatureC, null);
  assert.equal(sensors.humidityPercent, null);
  assert.equal(sensors.rssi, null);
  assert.equal(sensors.updatedAt, "");
});

test("weather units can be configured independently", () => {
  const location = saveWeatherLocation({
    label: "Madrid",
    country: "ES",
    latitude: "40,4168",
    longitude: "-3,7038",
    temperatureUnit: "celsius",
    windUnit: "kmh",
  });

  assert.equal(location.temperatureUnit, "celsius");
  assert.equal(location.windUnit, "kmh");
  assert.equal(location.units, "metric");
  assert.equal(location.latitude, 40.4168);
  assert.equal(location.longitude, -3.7038);

  const saved = getWeatherLocation();
  assert.equal(saved.temperatureUnit, "celsius");
  assert.equal(saved.windUnit, "kmh");
});

test("ICS parser applies recurrence overrides and cancellations", () => {
  const calendar = {
    id: "cal-1",
    name: "Daniel",
    color: "#0000FF",
  };
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My Terminal//Tests//EN",
    "BEGIN:VEVENT",
    "UID:daily-1",
    "DTSTART:20260817T090000Z",
    "DTEND:20260817T100000Z",
    "RRULE:FREQ=DAILY;COUNT=3",
    "SUMMARY:Standup",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:daily-1",
    "RECURRENCE-ID:20260818T090000Z",
    "DTSTART:20260818T110000Z",
    "DTEND:20260818T120000Z",
    "SUMMARY:Standup movido",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:daily-1",
    "RECURRENCE-ID:20260819T090000Z",
    "DTSTART:20260819T090000Z",
    "DTEND:20260819T100000Z",
    "STATUS:CANCELLED",
    "SUMMARY:Standup cancelado",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcsEvents(
    ics,
    calendar,
    [],
    new Date("2026-08-17T00:00:00Z"),
    new Date("2026-08-20T00:00:00Z"),
  );

  assert.deepEqual(
    events.map((event) => [event.title, event.startsAt]),
    [
      ["Standup", "2026-08-17T09:00:00.000Z"],
      ["Standup movido", "2026-08-18T11:00:00.000Z"],
    ],
  );
});

test("ICS parser filters titles by configured keywords", () => {
  const calendar = {
    id: "cal-1",
    name: "Daniel",
    color: "#0000FF",
  };
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My Terminal//Tests//EN",
    "BEGIN:VEVENT",
    "UID:hidden-1",
    "DTSTART:20260817T090000Z",
    "DTEND:20260817T100000Z",
    "SUMMARY:Viaje privado",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:visible-1",
    "DTSTART:20260817T110000Z",
    "DTEND:20260817T120000Z",
    "SUMMARY:Reunion",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcsEvents(
    ics,
    calendar,
    [(title) => title.toLowerCase().includes("privado")],
    new Date("2026-08-17T00:00:00Z"),
    new Date("2026-08-18T00:00:00Z"),
  );

  assert.deepEqual(events.map((event) => event.title), ["Reunion"]);
});

test("calendar diagnostics reports missing URLs", async () => {
  const result = await getCalendarDiagnostics([
    {
      id: "cal-1",
      name: "Daniel",
      url: "",
      color: "#0000FF",
      enabled: true,
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.equal(result.calendars[0].status, "missing-url");
});

test("calendar diagnostics reads valid ICS feeds", async () => {
  const originalFetch = global.fetch;
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 1);
  startsAt.setUTCHours(9, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My Terminal//Tests//EN",
    "BEGIN:VEVENT",
    "UID:diagnostic-1",
    `DTSTART:${formatIcsUtc(startsAt)}`,
    `DTEND:${formatIcsUtc(endsAt)}`,
    "SUMMARY:Prueba calendario",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  global.fetch = async () =>
    new Response(ics, {
      status: 200,
      headers: { "Content-Type": "text/calendar" },
    });

  try {
    const result = await getCalendarDiagnostics([
      {
        id: "cal-1",
        name: "Daniel",
        url: "https://example.test/calendar.ics",
        color: "#0000FF",
        enabled: true,
      },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.checked, 1);
    assert.equal(result.calendars[0].status, "ok");
    assert.equal(result.calendars[0].eventCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("auth middleware enforces admin and device tokens when configured", () => {
  process.env.ADMIN_TOKEN = "admin-test-token";
  process.env.DEVICE_TOKEN = "device-test-token";
  delete require.cache[require.resolve("./auth")];
  const { requireAdmin, requireDevice } = require("./auth");

  assert.equal(runMiddleware(requireAdmin, fakeRequest({})).status, 401);
  assert.equal(
    runMiddleware(requireAdmin, fakeRequest({ "x-admin-token": "admin-test-token" })).nextCalled,
    true,
  );
  assert.equal(runMiddleware(requireDevice, fakeRequest({})).status, 401);
  assert.equal(
    runMiddleware(requireDevice, fakeRequest({ "x-device-token": "device-test-token" })).nextCalled,
    true,
  );
  assert.equal(
    runMiddleware(requireDevice, fakeRequest({ authorization: "Bearer admin-test-token" })).nextCalled,
    true,
  );
});

function fakeRequest(headers) {
  return {
    query: {},
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

function runMiddleware(middleware, req) {
  const result = {
    nextCalled: false,
    status: null,
    body: null,
  };
  const res = {
    status(code) {
      result.status = code;
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };

  middleware(req, res, () => {
    result.nextCalled = true;
  });

  return result;
}

function formatIcsUtc(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
