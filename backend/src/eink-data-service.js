const {
  getCalendars,
  getDeviceSettings,
  getEventExceptions,
  getScreenState,
  getWeatherLocation,
} = require("./database");
const { getCalendarEvents } = require("./ics-service");
const { getMadridHolidays } = require("./holiday-service");
const { getWeatherData } = require("./weather-service");
const {
  addDays,
  addMonths,
  buildMonthDays,
  maxDate,
  minDate,
  startOfLocalDay,
  toDateKey,
} = require("./date-utils");

async function getEinkData(options = {}) {
  const state = getScreenState();
  const monthOffset = normalizeMonthOffset(options.monthOffset, state.monthOffset);
  const now = new Date();
  const today = startOfLocalDay(now);
  const todayKey = toDateKey(today);
  const anchor = addMonths(today, monthOffset);
  const monthDays = buildMonthDays(anchor);
  const gridStart = monthDays[0].date;
  const gridEnd = addDays(monthDays[monthDays.length - 1].date, 1);
  const todayEnd = addDays(today, 1);
  const dataRangeStart = minDate(gridStart, today);
  const dataRangeEnd = maxDate(gridEnd, todayEnd);
  const calendars = getCalendars();
  const exceptions = getEventExceptions();
  const weatherLocation = getWeatherLocation({ includeSecret: true });
  const deviceSettings = getDeviceSettings();

  const [calendarEvents, holidays, weather] = await Promise.all([
    getCalendarEvents(calendars, exceptions, dataRangeStart, dataRangeEnd),
    getMadridHolidays(dataRangeStart, dataRangeEnd).catch((error) => {
      console.error("Could not read Madrid holidays:", error);
      return [];
    }),
    getWeatherData(weatherLocation),
  ]);

  const calendarEventsByDate = groupEventsByDate(calendarEvents);
  const holidaysByDate = groupEventsByDate(holidays);
  const todayEvents = buildTodayEvents(calendarEvents, holidays, todayKey);

  return {
    generatedAt: now.toISOString(),
    timezone: deviceSettings.timezone,
    todayKey,
    activeMonth: {
      offset: monthOffset,
      year: anchor.getFullYear(),
      month: anchor.getMonth() + 1,
      label: formatMonth(anchor),
    },
    navigation: {
      previousEndpoint: "/api/screen/month/previous",
      nextEndpoint: "/api/screen/month/next",
      currentEndpoint: "/api/screen/month/current",
    },
    calendars: calendars
      .filter((calendar) => calendar.enabled)
      .map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        color: calendar.color,
      })),
    currentWeather: weather.current,
    days: monthDays.map((day) => {
      const key = day.dateKey;
      const dayEvents = calendarEventsByDate.get(key) || [];
      const dayHolidays = holidaysByDate.get(key) || [];

      return {
        dateKey: key,
        dayNumber: day.dayNumber,
        weekday: day.weekday,
        isCurrentMonth: day.isCurrentMonth,
        isToday: key === todayKey,
        isSunday: day.weekday === 0,
        isHoliday: dayHolidays.length > 0,
        holidays: dayHolidays.map((holiday) => holiday.title),
        weatherCondition: weather.forecastByDate[key]?.condition || null,
        eventCalendars: uniqueEventCalendars(dayEvents),
      };
    }),
    todayEvents,
  };
}

function groupEventsByDate(events) {
  return events.reduce((map, event) => {
    for (const dateKey of event.dateKeys || [event.dateKey]) {
      const dayEvents = map.get(dateKey) || [];
      dayEvents.push(event);
      map.set(dateKey, dayEvents);
    }

    return map;
  }, new Map());
}

function uniqueEventCalendars(events) {
  const seen = new Set();
  const calendars = [];

  for (const event of events) {
    if (seen.has(event.calendarId)) {
      continue;
    }

    seen.add(event.calendarId);
    calendars.push({
      id: event.calendarId,
      name: event.calendarName,
      color: event.calendarColor,
    });
  }

  return calendars.slice(0, 4);
}

function buildTodayEvents(calendarEvents, holidays, todayKey) {
  const todayCalendarEvents = calendarEvents.filter((event) =>
    (event.dateKeys || []).includes(todayKey),
  );
  const todayHolidayEvents = holidays
    .filter((holiday) => holiday.dateKey === todayKey)
    .map((holiday) => ({
      ...holiday,
      dateKeys: [todayKey],
    }));

  return [...todayHolidayEvents, ...todayCalendarEvents]
    .sort(sortEvents)
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      calendarColor: event.calendarColor,
      source: event.source,
    }));
}

function sortEvents(a, b) {
  if (a.allDay !== b.allDay) {
    return a.allDay ? -1 : 1;
  }

  return new Date(a.startsAt) - new Date(b.startsAt);
}

function normalizeMonthOffset(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number < -36 || number > 36) {
    return fallback;
  }

  return number;
}

function formatMonth(date) {
  const month = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(date);

  return month.charAt(0).toUpperCase() + month.slice(1);
}

module.exports = {
  getEinkData,
};
