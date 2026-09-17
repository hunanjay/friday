import { describe, expect, it } from 'vitest';
import {
  dashboardCalendarRange,
  eventDayKey,
  eventTimestamp,
  formatDashboardClock,
  formatDashboardDate,
  formatEventMeta,
  greetingFor,
} from './dashboardTime';

const afternoon = new Date('2026-09-10T07:55:04Z');

describe('dashboard time', () => {
  it('uses the dashboard timezone for the live clock and greeting', () => {
    expect(formatDashboardClock(afternoon, 'en-US')).toBe('15:55:04');
    expect(formatDashboardDate(afternoon, 'zh-CN')).toBe('9月10日 星期四');
    expect(greetingFor(afternoon, false, 'jian')).toBe('Good afternoon, jian');
    expect(greetingFor(afternoon, true, '简')).toBe('下午好，简');
  });

  it('loads calendar events from the start of today instead of the current instant', () => {
    expect(dashboardCalendarRange(afternoon)).toEqual({
      start: '2026-09-09T16:00:00.000Z',
      end: '2026-09-16T16:00:00.000Z',
    });
  });

  it('interprets offset-free Graph event times as China Standard Time', () => {
    const event = { start: { dateTime: '2026-09-10T09:00:00.0000000' } };
    expect(eventDayKey(event)).toBe('2026-09-10');
    expect(eventTimestamp(event)).toBe(new Date('2026-09-10T01:00:00.000Z').valueOf());
  });

  it('adds a date to non-today event bubbles while keeping today compact', () => {
    const today = { start: { dateTime: '2026-09-10T17:00:00' } };
    const tomorrow = { start: { dateTime: '2026-09-11T09:00:00' } };
    expect(formatEventMeta(today, 'en-US', 'All day', afternoon)).toBe('17:00');
    expect(formatEventMeta(tomorrow, 'en-US', 'All day', afternoon)).toBe('9/11 09:00');
  });
});
