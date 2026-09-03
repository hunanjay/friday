import React from 'react';
import { Button, Text } from '@fluentui/react-components';
import {
  CalendarLtr24Regular,
  Mail24Regular,
  NoteAdd24Regular,
  Open24Regular,
  Radar20Regular,
} from '@fluentui/react-icons';

export function EmptyState({ action, icon, message, onAction }) {
  return (
    <div className="dashboard-empty-state">
      {icon}
      <Text>{message}</Text>
      {action && <Button appearance="subtle" size="small" onClick={onAction}>{action}</Button>}
    </div>
  );
}

export function PanelSkeleton({
  avatars = false,
  badges = false,
  dates = false,
  rows = 3,
  swatches = false,
  times = false,
}) {
  return (
    <div className="dashboard-panel-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="dashboard-skeleton-row">
          {times && <span className="dashboard-skeleton-time" />}
          {avatars && <span className="dashboard-skeleton-avatar" />}
          {swatches && <span className="dashboard-skeleton-swatch" />}
          {badges && <span className="dashboard-skeleton-badge" />}
          <span className="dashboard-skeleton-lines">
            <span className="dashboard-skeleton-line" style={{ width: `${70 + (index % 3) * 10}%` }} />
            <span className="dashboard-skeleton-line dashboard-skeleton-line--short" style={{ width: `${40 + (index % 2) * 15}%` }} />
          </span>
          {dates && <span className="dashboard-skeleton-date" />}
        </div>
      ))}
    </div>
  );
}

// A contact worth reaching out to isn't something this app can compute yet -
// there's no interaction-recency or reminder feature behind it. Ship the
// panel now so the layout and intent are visible, but never fabricate
// per-contact rows here; that's real backend work for another day.
function RelationshipRadar({ copy }) {
  return (
    <div className="dashboard-panel dashboard-radar-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <Radar20Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.radarTitle}</h2>
        </div>
        <span className="dashboard-panel-tag preview">{copy.radarPreviewTag}</span>
      </div>
      <p className="dashboard-radar-preview-copy">{copy.radarPreviewCopy}</p>
    </div>
  );
}

function GitHubTicker({ commits, formatCommitDate, locale }) {
  const items = commits.slice(0, 3);
  return (
    <>
      <div className="dashboard-commit-ticker">
        {items.map((commit, index) => (
          <div
            className="dashboard-commit-ticker-item"
            style={{ animationDelay: `${index * 3}s` }}
            key={`${commit.repo}-${commit.sha}`}
          >
            <span className="ticker-repo">{commit.repo}</span>
            <div className="ticker-text">
              <div className="ticker-msg">{commit.message?.split('\n')[0]}</div>
              <div className="ticker-when">
                {commit.date ? formatCommitDate(commit.date, locale) : ''} · {commit.author}
              </div>
            </div>
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <div className="dashboard-ticker-dots">
          {items.map((commit, index) => (
            <span key={`${commit.repo}-${commit.sha}-dot`} style={{ animationDelay: `${index * 3}s` }} />
          ))}
        </div>
      )}
    </>
  );
}

function GitHubPanel({ copy, formatCommitDate, github, locale, navigate }) {
  return (
    <div className="dashboard-panel dashboard-github-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <NoteAdd24Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.githubTitle}</h2>
          {github.isConnected && <span className="dashboard-pulse-dot" title={copy.connect} />}
        </div>
        <div className="dashboard-panel-header-actions">
          {github.isConnected && github.commits.length > 0 && (
            <span className="dashboard-panel-tag">{github.commits.length} {copy.commits}</span>
          )}
          <Button appearance="subtle" size="small" icon={<Open24Regular />} onClick={() => navigate('/settings/github')}>
            {copy.openGithub}
          </Button>
        </div>
      </div>

      {github.isLoading ? <PanelSkeleton rows={3} badges /> : github.isConnected ? (
        github.commits.length ? (
          <GitHubTicker commits={github.commits} formatCommitDate={formatCommitDate} locale={locale} />
        ) : (
          <EmptyState
            icon={<NoteAdd24Regular />}
            message={copy.noCommits}
            action={copy.openGithub}
            onAction={() => navigate('/settings/github')}
          />
        )
      ) : (
        <EmptyState
          icon={<NoteAdd24Regular />}
          message={copy.disconnected}
          action={copy.connect}
          onAction={() => navigate('/settings/github')}
        />
      )}
    </div>
  );
}

export function DashboardSecondaryPanels({ copy, formatCommitDate, github, locale, navigate }) {
  return (
    <div className="dashboard-column-stack">
      <RelationshipRadar copy={copy} />
      <GitHubPanel
        copy={copy}
        formatCommitDate={formatCommitDate}
        github={github}
        locale={locale}
        navigate={navigate}
      />
    </div>
  );
}

// Low-commitment "glance, don't process" surface for mail + calendar - each
// item floats independently (desynced via inline --dur/--delay) rather than
// sitting in a browsable list, since these aren't today's priorities.
export function DashboardBubbleField({ copy, eventTime, events, emails, formatEmailDate, isZh, locale, navigate }) {
  const bubbles = [
    ...events.map(event => ({
      key: `event-${event.id}`,
      kind: 'calendar',
      title: event.subject || (isZh ? '未命名日程' : 'Untitled event'),
      meta: event.isAllDay ? copy.allDay : eventTime(event, locale),
      onClick: () => navigate('/calendar', { state: { eventId: event.id } }),
    })),
    ...emails.map(email => ({
      key: `email-${email.id}`,
      kind: 'mail',
      title: email.subject || (isZh ? '无主题' : 'No subject'),
      meta: email.receivedDateTime ? formatEmailDate(email.receivedDateTime, locale) : '',
      onClick: () => navigate('/email', { state: { emailId: email.id, email } }),
    })),
  ];

  if (!bubbles.length) return null;

  return (
    <section className="dashboard-bubble-field">
      <span className="dashboard-bubble-field-label">{copy.bubbleFieldLabel}</span>
      <div className="dashboard-bubble-row">
        {bubbles.map((bubble, index) => (
          <button
            type="button"
            key={bubble.key}
            className={`dashboard-bubble ${bubble.kind === 'mail' ? 'bubble-mail' : 'bubble-cal'}`}
            style={{ '--dur': `${4.4 + (index % 4) * 0.55}s`, '--delay': `-${(index * 1.3) % 4}s` }}
            onClick={bubble.onClick}
          >
            <span className="dashboard-bubble-icon">
              {bubble.kind === 'mail' ? <Mail24Regular /> : <CalendarLtr24Regular />}
            </span>
            <span className="dashboard-bubble-text">
              {bubble.title}
              {bubble.meta && <em>{bubble.meta}</em>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
