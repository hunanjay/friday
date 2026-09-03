import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  radarPreviewCopy: 'Coming soon: proactive nudges for who to reach out to.',
  radarPreviewTag: 'Concept preview',
  radarTitle: 'Relationship Radar',
  unread: 'Unread mail',
};

describe('DashboardSecondaryPanels', () => {
  it('renders the relationship radar placeholder and a GitHub commit ticker', () => {
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
      />
    );

    expect(screen.getByText('Relationship Radar')).toBeInTheDocument();
    expect(screen.getByText(copy.radarPreviewCopy)).toBeInTheDocument();
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
      />
    );
    expect(screen.getByText('Not connected')).toBeInTheDocument();
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
