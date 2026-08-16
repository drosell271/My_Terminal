const { createHash } = require("node:crypto");
const ICAL = require("ical.js");
const { getCacheEntry, setCacheEntry } = require("./database");
const {
  addDays,
  getTouchedDateKeys,
  overlapsRange,
  toDateKey,
} = require("./date-utils");

const ICS_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_OCCURRENCES_PER_EVENT = 5000;

async function getCalendarEvents(calendars, exceptions, rangeStart, rangeEnd) {
  const enabledCalendars = calendars.filter((calendar) => calendar.enabled && calendar.url);
  const keywordMatchers = buildKeywordMatchers(exceptions);
  const results = await Promise.allSettled(
    enabledCalendars.map((calendar) =>
      getSingleCalendarEvents(calendar, keywordMatchers, rangeStart, rangeEnd),
    ),
  );

  return results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    console.error(
      `Could not read calendar ${enabledCalendars[index].name}:`,
      result.reason,
    );
    return [];
  });
}

async function getSingleCalendarEvents(calendar, keywordMatchers, rangeStart, rangeEnd) {
  const cacheKey = `ics:${calendar.id}:${hash(calendar.url)}`;
  const cached = getCacheEntry(cacheKey);
  const icsText = cached || await fetchIcs(calendar.url);

  if (!cached) {
    setCacheEntry(cacheKey, icsText, ICS_CACHE_TTL_MS);
  }

  return parseIcsEvents(icsText, calendar, keywordMatchers, rangeStart, rangeEnd);
}

function parseIcsEvents(icsText, calendar, keywordMatchers, rangeStart, rangeEnd) {
  const component = new ICAL.Component(ICAL.parse(icsText));
  const timezoneService = ICAL.TimezoneService;

  component.getAllSubcomponents("vtimezone").forEach((timezone) => {
    const tzid = timezone.getFirstPropertyValue("tzid");
    if (tzid) {
      timezoneService.register(new ICAL.Timezone(timezone), tzid);
    }
  });

  const events = component
    .getAllSubcomponents("vevent")
    .map((vevent) => new ICAL.Event(vevent));

  return expandEventSet(events, calendar, keywordMatchers, rangeStart, rangeEnd)
    .sort(sortEvents);
}

function expandEventSet(events, calendar, keywordMatchers, rangeStart, rangeEnd) {
  const masters = [];
  const overridesByUid = new Map();
  const cancellationsByUid = new Map();
  const cancelledMasters = new Set();

  for (const event of events) {
    const uid = getEventUid(event);
    const recurrenceId = getRecurrenceId(event);

    if (recurrenceId) {
      const key = timeKey(recurrenceId);
      if (isCancelled(event)) {
        mapSetForUid(cancellationsByUid, uid).add(key);
      } else {
        mapForUid(overridesByUid, uid).set(key, event);
      }
      continue;
    }

    if (isCancelled(event)) {
      cancelledMasters.add(uid);
      continue;
    }

    masters.push(event);
  }

  const masterUids = new Set(masters.map(getEventUid));
  const results = [];

  for (const master of masters) {
    const uid = getEventUid(master);
    if (cancelledMasters.has(uid)) {
      continue;
    }

    results.push(...expandEvent(
      master,
      calendar,
      keywordMatchers,
      rangeStart,
      rangeEnd,
      mapForUid(overridesByUid, uid),
      mapSetForUid(cancellationsByUid, uid),
    ));
  }

  for (const [uid, overrides] of overridesByUid.entries()) {
    if (masterUids.has(uid)) {
      continue;
    }

    for (const [recurrenceKey, event] of overrides.entries()) {
      const normalized = normalizeOccurrence(event, event.startDate, event.endDate, {
        calendar,
        keywordMatchers,
        rangeStart,
        rangeEnd,
        occurrenceId: `${uid}:${recurrenceKey}:detached`,
      });

      if (normalized) {
        results.push(normalized);
      }
    }
  }

  return results;
}

function expandEvent(
  event,
  calendar,
  keywordMatchers,
  rangeStart,
  rangeEnd,
  overrides,
  cancellations,
) {
  if (!event.isRecurring()) {
    const normalized = normalizeOccurrence(event, event.startDate, event.endDate, {
      calendar,
      keywordMatchers,
      rangeStart,
      rangeEnd,
      occurrenceId: getEventUid(event),
    });

    return normalized ? [normalized] : [];
  }

  const occurrences = [];
  const iterator = event.iterator();

  for (let count = 0; count < MAX_OCCURRENCES_PER_EVENT; count += 1) {
    const next = iterator.next();

    if (!next) {
      break;
    }

    const recurrenceKey = timeKey(next);
    if (cancellations.has(recurrenceKey)) {
      continue;
    }

    const override = overrides.get(recurrenceKey);
    const sourceEvent = override || event;
    const details = override
      ? { startDate: override.startDate, endDate: override.endDate }
      : event.getOccurrenceDetails(next);
    const startsAt = details.startDate.toJSDate();
    const endsAt = getEndDate(
      details.startDate,
      details.endDate,
      startsAt,
      Boolean(details.startDate.isDate),
    );

    if (startsAt >= rangeEnd) {
      break;
    }

    if (endsAt <= rangeStart) {
      continue;
    }

    const normalized = normalizeOccurrence(sourceEvent, details.startDate, details.endDate, {
      calendar,
      keywordMatchers,
      rangeStart,
      rangeEnd,
      occurrenceId: `${getEventUid(event)}:${recurrenceKey}`,
    });

    if (normalized) {
      occurrences.push(normalized);
    }
  }

  return occurrences;
}

function normalizeOccurrence(event, startTime, endTime, options) {
  const title = normalizeTitle(event.summary);
  if (options.keywordMatchers.some((matcher) => matcher(title))) {
    return null;
  }

  const startsAt = startTime.toJSDate();
  const allDay = Boolean(startTime.isDate);
  const endsAt = getEndDate(startTime, endTime, startsAt, allDay);

  if (!overlapsRange(startsAt, endsAt, options.rangeStart, options.rangeEnd)) {
    return null;
  }

  const dateKeys = getTouchedDateKeys(startsAt, endsAt, allDay);
  const uid = options.occurrenceId || event.uid || options.title;

  return {
    id: `${options.calendar.id}:${hash(`${uid}:${startsAt.toISOString()}`)}`,
    title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    allDay,
    dateKeys,
    calendarId: options.calendar.id,
    calendarName: options.calendar.name,
    calendarColor: options.calendar.color,
    source: "ics",
  };
}

function getEventUid(event) {
  return String(event.uid || event.component.getFirstPropertyValue("uid") || "event");
}

function getRecurrenceId(event) {
  return event.component.getFirstPropertyValue("recurrence-id");
}

function isCancelled(event) {
  return String(event.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";
}

function timeKey(time) {
  return `${time.isDate ? "D" : "T"}:${time.toJSDate().toISOString()}`;
}

function mapForUid(source, uid) {
  if (!source.has(uid)) {
    source.set(uid, new Map());
  }

  return source.get(uid);
}

function mapSetForUid(source, uid) {
  if (!source.has(uid)) {
    source.set(uid, new Set());
  }

  return source.get(uid);
}

function getEndDate(startTime, endTime, startsAt, allDay) {
  if (endTime) {
    const endsAt = endTime.toJSDate();
    if (endsAt > startsAt) {
      return endsAt;
    }
  }

  if (allDay || startTime.isDate) {
    return addDays(startsAt, 1);
  }

  return new Date(startsAt.getTime() + 60 * 60 * 1000);
}

async function fetchIcs(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(normalizeCalendarUrl(url), {
      headers: {
        Accept: "text/calendar,text/plain,*/*",
        "User-Agent": "eink-dashboard/0.1",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ICS request failed with HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCalendarUrl(url) {
  return String(url).replace(/^webcal:\/\//i, "https://");
}

function buildKeywordMatchers(exceptions) {
  return (exceptions || [])
    .map((exception) => normalizeSearchText(exception.keyword || exception))
    .filter(Boolean)
    .map((keyword) => (title) => normalizeSearchText(title).includes(keyword));
}

function normalizeTitle(value) {
  return String(value || "Sin titulo").trim() || "Sin titulo";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hash(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 20);
}

function sortEvents(a, b) {
  if (a.allDay !== b.allDay) {
    return a.allDay ? -1 : 1;
  }

  return new Date(a.startsAt) - new Date(b.startsAt);
}

module.exports = {
  getCalendarEvents,
  parseIcsEvents,
  toDateKey,
};
