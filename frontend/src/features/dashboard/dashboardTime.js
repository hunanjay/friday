export const DASHBOARD_TIME_ZONE = 'Asia/Shanghai';

const DASHBOARD_UTC_OFFSET = '+08:00';

export function dayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function shiftDayKey(dateKey, offsetDays) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

export function dashboardCalendarRange(date = new Date()) {
  const startDay = dayKey(date);
  const endDay = shiftDayKey(startDay, 7);
  return {
    start: new Date(`${startDay}T00:00:00${DASHBOARD_UTC_OFFSET}`).toISOString(),
    end: new Date(`${endDay}T00:00:00${DASHBOARD_UTC_OFFSET}`).toISOString(),
  };
}

export function eventDateTime(event) {
  return event?.start?.dateTime || event?.startDateTime || '';
}

export function parseDashboardDateTime(value) {
  if (!value) return null;
  // Microsoft Graph returns the calendar digits in China Standard Time when
  // requested with the Prefer header, but deliberately omits a UTC offset.
  // Add that offset before parsing so comparisons do not accidentally use the
  // browser's timezone. Trim sub-millisecond precision for consistent parsing.
  const millisecondsOnly = value.replace(/(\.\d{3})\d+/, '$1');
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(millisecondsOnly);
  const parsed = new Date(hasOffset ? millisecondsOnly : `${millisecondsOnly}${DASHBOARD_UTC_OFFSET}`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function eventDayKey(event) {
  const value = eventDateTime(event);
  if (!value) return '';
  // Offset-free Graph values are already expressed in the dashboard timezone,
  // so their leading date is authoritative and should not be shifted again.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return value.slice(0, 10);
  const parsed = parseDashboardDateTime(value);
  return parsed ? dayKey(parsed) : value.slice(0, 10);
}

export function eventTimestamp(event) {
  return parseDashboardDateTime(eventDateTime(event))?.valueOf() ?? Number.NaN;
}

export function dashboardHour(date = new Date()) {
  const hourPart = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: DASHBOARD_TIME_ZONE,
  }).formatToParts(date).find(part => part.type === 'hour');
  return Number(hourPart?.value || 0);
}

export function greetingFor(date, isZh, name) {
  const hour = dashboardHour(date);
  const period = hour < 12
    ? (isZh ? '早上好' : 'Good morning')
    : hour < 18
      ? (isZh ? '下午好' : 'Good afternoon')
      : (isZh ? '晚上好' : 'Good evening');
  return isZh ? `${period}，${name}` : `${period}, ${name}`;
}

export function formatDashboardDate(date, locale) {
  if (locale.toLowerCase().startsWith('zh')) {
    const monthAndDay = new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      timeZone: DASHBOARD_TIME_ZONE,
    }).format(date);
    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      timeZone: DASHBOARD_TIME_ZONE,
    }).format(date);
    return `${monthAndDay} ${weekday}`;
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: DASHBOARD_TIME_ZONE,
  }).format(date);
}

export function formatDashboardClock(date, locale) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: DASHBOARD_TIME_ZONE,
  }).format(date);
}

export function formatEventMeta(event, locale, allDayLabel, date = new Date()) {
  const parsed = parseDashboardDateTime(eventDateTime(event));
  if (!parsed) return '';
  const sameDay = eventDayKey(event) === dayKey(date);
  const time = event.isAllDay
    ? allDayLabel
    : new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: DASHBOARD_TIME_ZONE,
      }).format(parsed);
  if (sameDay) return time;
  const eventDate = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    timeZone: DASHBOARD_TIME_ZONE,
  }).format(parsed);
  return `${eventDate} ${time}`;
}
