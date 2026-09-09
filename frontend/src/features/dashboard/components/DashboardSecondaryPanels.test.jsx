import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardBubbleField, DashboardSecondaryPanels } from './DashboardSecondaryPanels';

const copy = {
  allDay: 'All day',
  bubbleFieldLabel: 'Mail · Calendar at a glance',
  commits: 'commits',
  connect: 'Connect',
  disconnected: 'Not connected',
  githubTitle: 'GitHub activity',
  noCommits: 'No commits',
  openGithub: 'GitHub',
  radarDismiss: 'Dismiss',
  radarDone: 'Done',
  radarEmpty: 'No relationship reminders pending.',
  radarTitle: 'Relationship Radar',
  unread: 'Unread mail',
};

describe('DashboardSecondaryPanels', () => {
  it('renders the relationship radar empty state and a GitHub commit ticker', () => {
    const navigate = vi.fn();
    render(
      <DashboardSecondaryPanels
        copy={copy}
        formatCommitDate={() => '08/25 10:00'}
        github={{
          commits: [{ repo: 'org/repo', sha: 'abc', message: 'Ship feature', author: 'Ada', date: 'now' }],
          isConnected: true,
          isLoading: false,
        }}
        locale="en"
        navigate={navigate}
        reminders={{ items: [], isLoading: false, onUpdate: vi.fn() }}
      />
    );

    expect(screen.getByText('Relationship Radar')).toBeInTheDocument();
    expect(screen.getByText(copy.radarEmpty)).toBeInTheDocument();
    expect(screen.getByText('Ship feature')).toBeInTheDocument();

    fireEvent.click(screen.getByText('GitHub'));
    expect(navigate).toHaveBeenCalledWith('/settings/github');
  });

  it('shows the disconnected empty state instead of a ticker when GitHub is not connected', () => {
    render(
      <DashboardSecondaryPanels
        copy={copy}
        formatCommitDate={() => ''}
        github={{ commits: [], isConnected: false, isLoading: false }}
        locale="en"
        navigate={vi.fn()}
        reminders={{ items: [], isLoading: false, onUpdate: vi.fn() }}
      />
    );
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('lists pending reminders and routes done/dismiss clicks to onUpdate', () => {
    const navigate = vi.fn();
    const onUpdate = vi.fn();
    render(
      <DashboardSecondaryPanels
        copy={copy}
        formatCommitDate={() => ''}
        formatReminderDate={() => '9/9'}
        github={{ commits: [], isConnected: false, isLoading: false }}
        locale="en"
        navigate={navigate}
        reminders={{
          items: [{ id: 'r1', contact_id: 'c1', contact_name: 'Ada', reason: '9月开学', due_at: '2026-09-09T00:00:00+00:00', suggested_action: '问问情况' }],
          total: 1,
          isLoading: false,
          onUpdate,
        }}
      />
    );

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('9月开学')).toBeInTheDocument();
    expect(screen.getByText('9/9')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ada').closest('button'));
    expect(navigate).toHaveBeenCalledWith('/contacts', { state: { contactId: 'c1' } });

    fireEvent.click(screen.getByTitle('Done'));
    expect(onUpdate).toHaveBeenCalledWith('r1', 'done');

    fireEvent.click(screen.getByTitle('Dismiss'));
    expect(onUpdate).toHaveBeenCalledWith('r1', 'dismissed');
  });

  it('rotates through at most 3 reminders, one slot at a time, on the same clock as the GitHub ticker', () => {
    vi.useFakeTimers();
    const reminders = {
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`,
        contact_id: `c${i}`,
        contact_name: `Contact ${i}`,
        reason: `reason ${i}`,
      })),
      total: 5,
      isLoading: false,
      onUpdate: vi.fn(),
    };
    const commits = [
      { repo: 'org/a', sha: 'a', message: 'first', author: 'Ada' },
      { repo: 'org/b', sha: 'b', message: 'second', author: 'Bo' },
    ];
    const { container } = render(
      <DashboardSecondaryPanels
        copy={copy}
        formatCommitDate={() => ''}
        formatReminderDate={() => ''}
        github={{ commits, isConnected: true, isLoading: false }}
        locale="en"
        navigate={vi.fn()}
        reminders={reminders}
      />
    );

    // Only the current slot is ever mounted - no stacked, invisible item
    // competing for clicks - and there are dots for exactly the 3 shown.
    expect(container.querySelectorAll('.dashboard-radar-ticker-item')).toHaveLength(1);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Contact 0')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(container.querySelectorAll('.dashboard-radar-panel .dashboard-ticker-dots span')).toHaveLength(3);

    // One shared interval drives both panels, so they advance together.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Contact 1')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe('DashboardBubbleField', () => {
  it('renders mail and calendar bubbles and routes clicks', () => {
    const navigate = vi.fn();
    render(
      <DashboardBubbleField
        copy={copy}
        eventTime={() => '17:00'}
        events={[{ id: 'event-1', subject: 'Team sync', start: { dateTime: '2026-08-26T09:00:00Z' } }]}
        emails={[{
          id: 'email-1',
          subject: 'Quarterly update',
          receivedDateTime: 'now',
          sender: { emailAddress: { name: 'Grace' } },
        }]}
        formatEmailDate={() => '08/25'}
        isZh={false}
        locale="en"
        navigate={navigate}
      />
    );

    expect(screen.getByText('Team sync')).toBeInTheDocument();
    expect(screen.getByText('Quarterly update')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Team sync').closest('button'));
    expect(navigate).toHaveBeenCalledWith('/calendar', { state: { eventId: 'event-1' } });

    fireEvent.click(screen.getByText('Quarterly update').closest('button'));
    expect(navigate).toHaveBeenCalledWith('/email', expect.objectContaining({
      state: expect.objectContaining({ emailId: 'email-1' }),
    }));
  });

  it('renders nothing when there is no mail or calendar content', () => {
    const { container } = render(
      <DashboardBubbleField
        copy={copy}
        eventTime={() => ''}
        events={[]}
        emails={[]}
        formatEmailDate={() => ''}
        isZh={false}
        locale="en"
        navigate={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
