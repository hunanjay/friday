import React, { useEffect, useState } from 'react';
import { Avatar, Button, Text } from '@fluentui/react-components';
import {
  CalendarLtr24Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  Mail24Regular,
  NoteAdd24Regular,
  Open24Regular,
  Radar20Regular,
} from '@fluentui/react-icons';

const TICKER_SLOT_MS = 3000;

// One shared clock for every rotating side-panel ticker (Radar, GitHub) so
// they change slots on the same beat instead of drifting apart - each panel
// mounts (and starts loading) at a different time, so two independent
// `animation: ... infinite` loops would each start their own clock and fall
// out of phase with each other. `tick % items.length` per panel also means
// there's no dead slot to special-case when a panel has fewer than 3 items:
// 1 item just always resolves to index 0, 2 items alternate, etc.
function useSharedTicker() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), TICKER_SLOT_MS);
    return () => clearInterval(id);
  }, []);
  return tick;
}

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

// Explicit time-based reminders (issue #17 part A) that the contact agent
// created via create_contact_reminder. An upcoming-reminders preview sorted
// soonest-first, not a due-today inbox. Relationship-decay ("gone quiet")
// reminders aren't computed yet - that's still a real backend job for
// another day - so this only ever shows reminders someone actually asked for.
function RelationshipRadar({ copy, formatReminderDate, locale, navigate, reminders = {}, tick }) {
  const items = (reminders.items || []).slice(0, 3);
  const index = items.length ? tick % items.length : 0;
  const current = items[index];
  return (
    <div className="dashboard-panel dashboard-radar-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <Radar20Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.radarTitle}</h2>
        </div>
        {reminders.total > 0 && <span className="dashboard-panel-tag">{reminders.total}</span>}
      </div>

      {reminders.isLoading ? (
        <PanelSkeleton rows={2} />
      ) : !current ? (
        <p className="dashboard-radar-preview-copy">{copy.radarEmpty}</p>
      ) : (
        <>
          <div className="dashboard-radar-ticker">
            <div className="dashboard-radar-ticker-item" key={current.id}>
              <Avatar
                name={current.contact_name}
                image={current.contact_avatar_url ? { src: current.contact_avatar_url } : undefined}
                size={28}
              />
              <button
                type="button"
                className="dashboard-radar-item-main"
                onClick={() => navigate('/contacts', { state: { contactId: current.contact_id } })}
              >
                <span className="dashboard-radar-item-name-row">
                  <span className="dashboard-radar-item-name">{current.contact_name}</span>
                  <span className="dashboard-radar-item-date">{formatReminderDate(current.due_at, locale)}</span>
                </span>
                <span className="dashboard-radar-item-reason">{current.reason}</span>
              </button>
              <div className="dashboard-radar-item-actions">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Checkmark20Regular />}
                  title={copy.radarDone}
                  onClick={() => reminders.onUpdate(current.id, 'done')}
                />
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Dismiss20Regular />}
                  title={copy.radarDismiss}
                  onClick={() => reminders.onUpdate(current.id, 'dismissed')}
                />
              </div>
            </div>
          </div>
          {items.length > 1 && (
            <div className="dashboard-ticker-dots">
              {items.map((item, i) => (
                <span key={item.id} className={i === index ? 'active' : ''} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GitHubTicker({ commits, formatCommitDate, locale, tick }) {
  const items = commits.slice(0, 3);
  const index = items.length ? tick % items.length : 0;
  const current = items[index];
  if (!current) return null;
  return (
    <>
      <div className="dashboard-commit-ticker">
        <div className="dashboard-commit-ticker-item" key={`${current.repo}-${current.sha}`}>
          <span className="ticker-repo">{current.repo}</span>
          <div className="ticker-text">
            <div className="ticker-msg">{current.message?.split('\n')[0]}</div>
            <div className="ticker-when">
              {current.date ? formatCommitDate(current.date, locale) : ''} · {current.author}
            </div>
          </div>
        </div>
      </div>
      {items.length > 1 && (
        <div className="dashboard-ticker-dots">
          {items.map((commit, i) => (
            <span key={`${commit.repo}-${commit.sha}-dot`} className={i === index ? 'active' : ''} />
          ))}
        </div>
      )}
    </>
  );
}

function GitHubPanel({ copy, formatCommitDate, github, locale, navigate, tick }) {
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
          <GitHubTicker commits={github.commits} formatCommitDate={formatCommitDate} locale={locale} tick={tick} />
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

export function DashboardSecondaryPanels({ copy, formatCommitDate, formatReminderDate, github, locale, navigate, reminders }) {
  const tick = useSharedTicker();
  return (
    <div className="dashboard-column-stack">
      <RelationshipRadar copy={copy} formatReminderDate={formatReminderDate} locale={locale} navigate={navigate} reminders={reminders} tick={tick} />
      <GitHubPanel
        copy={copy}
        formatCommitDate={formatCommitDate}
        github={github}
        locale={locale}
        navigate={navigate}
        tick={tick}
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
