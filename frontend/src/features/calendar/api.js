import { apiRequest } from '../../api/client';

export function normalizeCalendarEvent(event) {
  return {
    id: event.id,
    subject: event.subject,
    start: event.start,
    end: event.end,
    body: event.body,
    categories: event.categories || [],
    location: event.location,
  };
}

export async function getCalendarEvents(token, { start, end }) {
  const data = await apiRequest('/api/graph/calendar/events', {
    token,
    query: { start, end },
  });
  return (data?.value || []).map(normalizeCalendarEvent);
}

export async function createCalendarEvent(token, event) {
  const data = await apiRequest('/api/graph/calendar/events', {
    method: 'POST',
    token,
    body: {
      subject: event.subject,
      start: event.start,
      end: event.end,
      location: event.location,
    },
  });
  const created = normalizeCalendarEvent(data);
  return {
    ...created,
    body: created.body?.content ? created.body : event.body,
    categories: created.categories.length ? created.categories : event.categories,
  };
}

export async function deleteCalendarEvent(token, eventId) {
  await apiRequest(`/api/graph/calendar/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    token,
  });
  return eventId;
}
