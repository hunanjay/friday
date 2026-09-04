import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvents,
  normalizeCalendarEvent,
  updateCalendarEvent,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

const rawEvent = {
  id: 'event-1',
  subject: 'Review',
  start: { dateTime: '2026-08-25T09:00:00' },
  end: { dateTime: '2026-08-25T10:00:00' },
  body: { content: '' },
  location: { displayName: 'Room 1' },
};

describe('calendar API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes optional event fields', () => {
    expect(normalizeCalendarEvent(rawEvent)).toEqual(expect.objectContaining({
      id: 'event-1',
      categories: [],
    }));
  });

  it('loads a bounded event range through the shared client', async () => {
    apiRequest.mockResolvedValueOnce({ value: [rawEvent] });

    await expect(getCalendarEvents('token', { start: 'start', end: 'end' })).resolves.toEqual([
      expect.objectContaining({ id: 'event-1' }),
    ]);
    expect(apiRequest).toHaveBeenCalledWith('/api/graph/calendar/events', {
      token: 'token',
      query: { start: 'start', end: 'end' },
    });
  });

  it('creates an event and retains client presentation fields when Graph omits them', async () => {
    const event = {
      subject: 'Review',
      start: '2026-08-25T09:00:00',
      end: '2026-08-25T10:00:00',
      location: 'Room 1',
      body: { content: 'Agenda', contentType: 'text' },
      categories: ['Work'],
    };
    apiRequest.mockResolvedValueOnce(rawEvent);

    await expect(createCalendarEvent('token', event)).resolves.toEqual(expect.objectContaining({
      id: 'event-1',
      body: event.body,
      categories: ['Work'],
    }));
    expect(apiRequest).toHaveBeenCalledWith('/api/graph/calendar/events', {
      method: 'POST',
      token: 'token',
      body: {
        subject: event.subject,
        start: event.start,
        end: event.end,
        location: event.location,
        categories: event.categories,
      },
    });
  });

  it('sends only the changed fields when updating, and keeps the id Graph may omit', async () => {
    apiRequest.mockResolvedValueOnce({ ...rawEvent, id: undefined });

    await expect(updateCalendarEvent('token', 'event/1', {
      start: '2026-08-25T14:00:00',
      end: '2026-08-25T15:00:00',
    })).resolves.toEqual(expect.objectContaining({ id: 'event/1' }));
    expect(apiRequest).toHaveBeenCalledWith('/api/graph/calendar/events/event%2F1', {
      method: 'PATCH',
      token: 'token',
      body: { start: '2026-08-25T14:00:00', end: '2026-08-25T15:00:00' },
    });
  });

  it('URL-encodes the event id when deleting', async () => {
    apiRequest.mockResolvedValueOnce({ ok: true });

    await expect(deleteCalendarEvent('token', 'event/1')).resolves.toBe('event/1');
    expect(apiRequest).toHaveBeenCalledWith('/api/graph/calendar/events/event%2F1', {
      method: 'DELETE',
      token: 'token',
    });
  });
});
