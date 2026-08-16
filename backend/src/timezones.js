const DEFAULT_TIMEZONE = "Europe/Madrid";

const TIMEZONE_OPTIONS = [
  {
    id: "Europe/Madrid",
    label: "Madrid / Peninsula",
    posix: "CET-1CEST,M3.5.0/2,M10.5.0/3",
  },
  {
    id: "Atlantic/Canary",
    label: "Canarias",
    posix: "WET0WEST,M3.5.0/1,M10.5.0/2",
  },
  {
    id: "UTC",
    label: "UTC",
    posix: "UTC0",
  },
  {
    id: "Europe/London",
    label: "Londres",
    posix: "GMT0BST,M3.5.0/1,M10.5.0/2",
  },
  {
    id: "Europe/Paris",
    label: "Paris / Berlin / Roma",
    posix: "CET-1CEST,M3.5.0/2,M10.5.0/3",
  },
  {
    id: "America/New_York",
    label: "Nueva York",
    posix: "EST5EDT,M3.2.0/2,M11.1.0/2",
  },
];

function normalizeTimezone(value, fallback = DEFAULT_TIMEZONE) {
  const timezone = String(value || "").trim();
  const valid = TIMEZONE_OPTIONS.some((option) => option.id === timezone);

  if (valid) {
    return timezone;
  }

  return TIMEZONE_OPTIONS.some((option) => option.id === fallback)
    ? fallback
    : DEFAULT_TIMEZONE;
}

function getTimezoneOption(value) {
  const timezone = normalizeTimezone(value);
  return TIMEZONE_OPTIONS.find((option) => option.id === timezone) || TIMEZONE_OPTIONS[0];
}

function timezoneToPosix(value) {
  return getTimezoneOption(value).posix;
}

function publicTimezoneOptions() {
  return TIMEZONE_OPTIONS.map(({ id, label }) => ({ id, label }));
}

module.exports = {
  DEFAULT_TIMEZONE,
  TIMEZONE_OPTIONS,
  getTimezoneOption,
  normalizeTimezone,
  publicTimezoneOptions,
  timezoneToPosix,
};
