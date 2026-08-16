const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid date key: ${key}`);
  }

  return new Date(year, month - 1, day);
}

function buildMonthDays(anchorDate) {
  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    1 - mondayOffset,
  );

  return Array.from({ length: 42 }, (_item, index) => {
    const date = addDays(gridStart, index);

    return {
      date,
      dateKey: toDateKey(date),
      dayNumber: date.getDate(),
      weekday: date.getDay(),
      isCurrentMonth: date.getMonth() === anchorDate.getMonth(),
    };
  });
}

function eachDateKey(startDate, endDateInclusive) {
  const keys = [];
  let cursor = startOfLocalDay(startDate);
  const end = startOfLocalDay(endDateInclusive);

  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return keys;
}

function getTouchedDateKeys(startDate, endDate, allDay) {
  const start = startOfLocalDay(startDate);
  let lastInstant;

  if (!endDate || endDate <= startDate) {
    lastInstant = allDay ? addDays(startDate, 1).getTime() - 1 : startDate.getTime();
  } else {
    lastInstant = allDay ? endDate.getTime() - 1 : endDate.getTime();
  }

  const end = startOfLocalDay(new Date(Math.max(startDate.getTime(), lastInstant)));

  return eachDateKey(start, end);
}

function overlapsRange(startDate, endDate, rangeStart, rangeEnd) {
  const effectiveEnd =
    endDate && endDate > startDate
      ? endDate
      : new Date(startDate.getTime() + DAY_MS);

  return startDate < rangeEnd && effectiveEnd > rangeStart;
}

function minDate(...dates) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(...dates) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

module.exports = {
  DAY_MS,
  addDays,
  addMonths,
  buildMonthDays,
  eachDateKey,
  fromDateKey,
  getTouchedDateKeys,
  maxDate,
  minDate,
  overlapsRange,
  startOfLocalDay,
  toDateKey,
};
