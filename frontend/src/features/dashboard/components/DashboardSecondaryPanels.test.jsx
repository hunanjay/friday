import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardSecondaryPanels } from './DashboardSecondaryPanels';

const copy = {
  agenda: 'Coming up',
  allDay: 'All day',
  connect: 'Connect',
  disconnected: 'Not connected',
  githubTitle: 'GitHub activity',
  inbox: 'Inbox notice',
  memoTitle: 'Recent notes',
  noCommits: 'No commits',
  noEmails: 'No email',
  noEvents: 'No events',
  noMemos: 'No memos',
  openCalendar: 'Calendar',
  openEmail: 'Inbox',
  openGithub: 'GitHub',
  openMemos: 'Memos',
  unread: 'Unread mail',
};

function panelProps() {
  return {
    agenda: {
      events: [{
        id: 'event-1',
        subject: 'Team sync',
        start: { dateTime: '2026-08-26T09:00:00Z' },
        location: { displayName: 'Room 1' },
      }],
      isLoading: false,
    },
    copy,
    eventDateTime: event => event.start.dateTime,
    eventTime: () => '17:00',
    formatCommitDate: () => '08/25 10:00',
    formatEmailDate: () => '08/25',
    github: {
      commits: [{ repo: 'org/repo', sha: 'abc', message: 'Ship feature', author: 'Ada', date: 'now' }],
      isConnected: true,
      isLoading: false,
      page: 1,
      setPage: vi.fn(),
      setWeekOffset: vi.fn(),
      totalPages: 2,
      weekInfo: { mondayStr: '8.24', sundayStr: '8.30' },
      weekOffset: 0,
    },
    inbox: {
      emails: [{
        id: 'email-1',
        subject: 'Quarterly update',
        receivedDateTime: 'now',
        sender: { emailAddress: { name: 'Grace' } },
      }],
      isLoading: false,
      unreadCount: 3,
    },
    isZh: false,
    locale: 'en',
    memos: {
      items: [{ id: 'memo-1', title: 'Idea', content: 'Build it', pinned: true }],
      isLoading: false,
    },
    navigate: vi.fn(),
  };
}

describe('DashboardSecondaryPanels', () => {
  it('renders independently loaded panel data and routes item actions', () => {
    const props = panelProps();
    render(<DashboardSecondaryPanels {...props} />);

    expect(screen.getByText('Team sync')).toBeInTheDocument();
    expect(screen.getByText('Quarterly update')).toBeInTheDocument();
    expect(screen.getByText('Idea')).toBeInTheDocument();
    expect(screen.getByText('Ship feature')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Team sync').closest('button'));
    expect(props.navigate).toHaveBeenCalledWith('/calendar', {
      state: { eventId: 'event-1', eventStart: '2026-08-26T09:00:00Z' },
    });
    fireEvent.click(screen.getByText('Quarterly update').closest('button'));
    expect(props.navigate).toHaveBeenCalledWith('/email', expect.objectContaining({
      state: expect.objectContaining({ emailId: 'email-1' }),
    }));
    fireEvent.click(screen.getByText('Idea').closest('button'));
    expect(props.navigate).toHaveBeenCalledWith('/memos', { state: { memoId: 'memo-1' } });
    fireEvent.click(screen.getByText('Ship feature').closest('button'));
    expect(props.navigate).toHaveBeenCalledWith('/settings', expect.any(Object));
  });

  it('keeps GitHub week and page controls inside the GitHub panel', () => {
    const props = panelProps();
    render(<DashboardSecondaryPanels {...props} />);

    fireEvent.click(screen.getByTitle('Previous week'));
    expect(props.github.setWeekOffset).toHaveBeenCalledWith(expect.any(Function));
    const pageButtons = document.querySelectorAll('.dashboard-page-btn');
    fireEvent.click(pageButtons[1]);
    expect(props.github.setPage).toHaveBeenCalledWith(expect.any(Function));
  });
});
