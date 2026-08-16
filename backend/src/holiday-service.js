const { getCacheEntry, setCacheEntry } = require("./database");
const { addDays, eachDateKey, fromDateKey, toDateKey } = require("./date-utils");

const HOLIDAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const COUNTRY_CODE = "ES";
const SUBDIVISION_CODE = "ES-MD";

async function getMadridHolidays(rangeStart, rangeEnd) {
  const years = getYearsInRange(rangeStart, rangeEnd);
  const holidaysByYear = await Promise.all(years.map(fetchSpanishHolidaysForYear));

  return holidaysByYear
    .flat()
    .filter(isMadridOrNationalHoliday)
    .flatMap(normalizeHoliday)
    .filter((holiday) => {
      const date = fromDateKey(holiday.dateKey);
      return date >= rangeStart && date < rangeEnd;
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

async function fetchSpanishHolidaysForYear(year) {
  const cacheKey = `holidays:${COUNTRY_CODE}:${SUBDIVISION_CODE}:${year}`;
  const cached = getCacheEntry(cacheKey);

  if (cached) {
    return cached;
  }

  const url = new URL("https://openholidaysapi.org/PublicHolidays");
  url.searchParams.set("countryIsoCode", COUNTRY_CODE);
  url.searchParams.set("languageIsoCode", "ES");
  url.searchParams.set("validFrom", `${year}-01-01`);
  url.searchParams.set("validTo", `${year}-12-31`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/json",
        "User-Agent": "eink-dashboard/0.1",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Holiday request failed with HTTP ${response.status}`);
    }

    const holidays = await response.json();
    return setCacheEntry(cacheKey, holidays, HOLIDAY_CACHE_TTL_MS);
  } finally {
    clearTimeout(timeout);
  }
}

function isMadridOrNationalHoliday(holiday) {
  if (holiday.nationwide) {
    return true;
  }

  return (holiday.subdivisions || []).some(
    (subdivision) => subdivision.code === SUBDIVISION_CODE,
  );
}

function normalizeHoliday(holiday) {
  const title = getHolidayName(holiday);
  const keys = eachDateKey(
    fromDateKey(holiday.startDate),
    fromDateKey(holiday.endDate || holiday.startDate),
  );

  return keys.map((dateKey) => ({
    id: `holiday:${holiday.id || `${dateKey}:${title}`}`,
    title,
    dateKey,
    startsAt: `${dateKey}T00:00:00.000`,
    endsAt: `${toDateKey(addDays(fromDateKey(dateKey), 1))}T00:00:00.000`,
    allDay: true,
    source: "holiday",
    calendarId: "holidays",
    calendarName: "Festivos",
    calendarColor: "#FF0000",
  }));
}

function getHolidayName(holiday) {
  const names = holiday.name || [];
  const spanish = names.find((entry) => entry.language === "ES");
  const first = names[0];

  return String(spanish?.text || first?.text || "Festivo").trim();
}

function getYearsInRange(rangeStart, rangeEnd) {
  const years = new Set();
  let year = rangeStart.getFullYear();
  const lastYear = new Date(rangeEnd.getTime() - 1).getFullYear();

  while (year <= lastYear) {
    years.add(year);
    year += 1;
  }

  return [...years];
}

module.exports = {
  getMadridHolidays,
};
