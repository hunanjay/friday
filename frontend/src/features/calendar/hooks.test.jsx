import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import { useCalendarEvents } from './hooks';

const apiMocks = vi.hoisted(() => ({
  createCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  getCalendarEvents: vi.fn(),
}));

vi.mock('./api', () => ({
  createCalendarEvent: apiMocks.createCalendarEvent,
  deleteCalendarEvent: apiMocks.deleteCalendarEvent,
  getCalendarEvents: apiMocks.getCalendarEvents,
}));

const range = { start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' };

function CalendarProbe({ id, controls = false }) {
  const { events, addCalendarEvent, deleteCalendarEvent } = useCalendarEvents(range);
  return (
    <div>
      <span data-testid={id}>{events.map(event => event.id).join(',')}</span>
      {controls && (
        <>
          <button onClick={() => addCalendarEvent({ subject: 'Second' })}>add</button>
          <button onClick={() => deleteCalendarEvent('event-1')}>delete</button>
        </>
      )}
    </div>
  );
}

function renderCalendar(auth) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <CalendarProbe id="first" controls />
        <CalendarProbe id="second" />
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe('calendar hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getCalendarEvents.mockResolvedValue([{ id: 'event-1' }]);
    apiMocks.createCalendarEvent.mockResolvedValue({ id: 'event-2' });
    apiMocks.deleteCalendarEvent.mockResolvedValue('event-1');
  });

  it('deduplicates range loading and synchronizes create and delete mutations', async () => {
    const auth = { authToken: 'token', user: { email: 'person@example.com' }, handleLogout: vi.fn() };
    renderCalendar(auth);

    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('event-1'));
    expect(apiMocks.getCalendarEvents).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('event-1,event-2'));

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('event-2'));
    expect(apiMocks.createCalendarEvent).toHaveBeenCalledWith('token', { subject: 'Second' });
    expect(apiMocks.deleteCalendarEvent).toHaveBeenCalledWith('token', 'event-1');
  });

  it('logs out when the calendar query reports an unauthorized session', async () => {
    const handleLogout = vi.fn();
    apiMocks.getCalendarEvents.mockRejectedValueOnce(new ApiError('Unauthorized', { status: 401 }));

    renderCalendar({ authToken: 'expired', user: { email: 'person@example.com' }, handleLogout });

    await waitFor(() => expect(handleLogout).toHaveBeenCalledOnce());
  });
});
