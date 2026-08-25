import React from 'react';
import { Badge, Button, Text } from '@fluentui/react-components';
import {
  CalendarLtr24Regular,
  DocumentBulletList24Regular,
  Mail24Regular,
  NoteAdd24Regular,
  Open24Regular,
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

function AgendaPanel({ copy, eventDateTime, eventTime, events, isLoading, isZh, locale, navigate }) {
  return (
    <div className="dashboard-panel dashboard-agenda-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <CalendarLtr24Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.agenda}</h2>
          <span className="dashboard-panel-tag">{isZh ? '7天内' : 'Next 7d'}</span>
        </div>
        <Button appearance="subtle" size="small" icon={<Open24Regular />} onClick={() => navigate('/calendar')}>
          {copy.openCalendar}
        </Button>
      </div>
      {isLoading ? <PanelSkeleton rows={3} times /> : events.length ? (
        <div className="dashboard-agenda-list">
          {events.map(event => (
            <button
              type="button"
              className="dashboard-list-item"
              key={event.id}
              onClick={() => navigate('/calendar', {
                state: { eventId: event.id, eventStart: eventDateTime(event) },
              })}
            >
              <span className="dashboard-agenda-time">
                {event.isAllDay ? copy.allDay : eventTime(event, locale)}
              </span>
              <div className="dashboard-item-text">
                <strong className="dashboard-item-title">
                  {event.subject || (isZh ? '未命名日程' : 'Untitled event')}
                </strong>
                <span className="dashboard-item-sub">
                  {event.location?.displayName || (isZh ? '未设置地点' : 'No location set')}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CalendarLtr24Regular />}
          message={copy.noEvents}
          action={copy.openCalendar}
          onAction={() => navigate('/calendar')}
        />
      )}
    </div>
  );
}

function InboxPanel({ copy, emails, formatEmailDate, isLoading, isZh, locale, navigate, unreadCount }) {
  return (
    <div className="dashboard-panel dashboard-inbox-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <Mail24Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.inbox}</h2>
          <span className="dashboard-panel-tag">{unreadCount} {copy.unread}</span>
        </div>
        <Button appearance="subtle" size="small" icon={<Open24Regular />} onClick={() => navigate('/email')}>
          {copy.openEmail}
        </Button>
      </div>
      {isLoading ? <PanelSkeleton rows={3} avatars dates /> : emails.length ? (
        <div className="dashboard-inbox-list">
          {emails.map(email => (
            <button
              type="button"
              className="dashboard-list-item"
              key={email.id}
              onClick={() => navigate('/email', { state: { emailId: email.id, email } })}
            >
              <span className="dashboard-email-avatar">
                {(email.from?.emailAddress?.name || email.sender?.emailAddress?.name || '?')[0]}
              </span>
              <div className="dashboard-item-text">
                <strong className="dashboard-item-title">
                  {email.subject || (isZh ? '无主题' : 'No subject')}
                </strong>
                <span className="dashboard-item-sub">
                  {email.from?.emailAddress?.name
                    || email.sender?.emailAddress?.name
                    || email.from?.emailAddress?.address
                    || ''}
                </span>
              </div>
              {email.receivedDateTime && (
                <span className="dashboard-item-date">
                  {formatEmailDate(email.receivedDateTime, locale)}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Mail24Regular />}
          message={copy.noEmails}
          action={copy.openEmail}
          onAction={() => navigate('/email')}
        />
      )}
    </div>
  );
}

function MemosPanel({ copy, isLoading, isZh, memos, navigate }) {
  return (
    <div className="dashboard-panel dashboard-memo-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <DocumentBulletList24Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.memoTitle}</h2>
          <span className="dashboard-panel-tag">{isZh ? '知识库' : 'Knowledge'}</span>
        </div>
        <Button appearance="subtle" size="small" icon={<Open24Regular />} onClick={() => navigate('/memos')}>
          {copy.openMemos}
        </Button>
      </div>
      {isLoading ? <PanelSkeleton rows={3} swatches /> : memos.length ? (
        <div className="dashboard-memo-list">
          {memos.map(memo => (
            <button
              type="button"
              className="dashboard-list-item"
              key={memo.id}
              onClick={() => navigate('/memos', { state: { memoId: memo.id } })}
            >
              <span className={`dashboard-memo-swatch memo-${memo.color || 'beige'}`} />
              <div className="dashboard-item-text">
                <strong className="dashboard-item-title">{memo.title}</strong>
                <span className="dashboard-item-sub">
                  {memo.content || (isZh ? '暂无内容' : 'No content')}
                </span>
              </div>
              {memo.pinned && (
                <Badge appearance="tint" color="important">{isZh ? '置顶' : 'Pinned'}</Badge>
              )}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<DocumentBulletList24Regular />}
          message={copy.noMemos}
          action={copy.openMemos}
          onAction={() => navigate('/memos')}
        />
      )}
    </div>
  );
}

function GitHubPanel({ copy, formatCommitDate, github, isZh, locale, navigate }) {
  return (
    <div className="dashboard-panel dashboard-github-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-title-group">
          <NoteAdd24Regular className="panel-title-icon" />
          <h2 className="panel-title-text">{copy.githubTitle}</h2>
          <span className="dashboard-panel-tag">
            {github.weekOffset === 0
              ? (isZh
                  ? `本周 ${github.weekInfo.mondayStr}-${github.weekInfo.sundayStr}`
                  : `This week ${github.weekInfo.mondayStr}-${github.weekInfo.sundayStr}`)
              : `${github.weekInfo.mondayStr}-${github.weekInfo.sundayStr}`}
          </span>
        </div>
        <div className="dashboard-panel-header-actions">
          <button
            type="button"
            className="dashboard-week-btn"
            onClick={() => github.setWeekOffset(previous => previous - 1)}
            title={isZh ? '上一周' : 'Previous week'}
          >
            ‹
          </button>
          {github.weekOffset !== 0 && (
            <button
              type="button"
              className="dashboard-week-btn reset"
              onClick={() => github.setWeekOffset(0)}
              title={isZh ? '回到本周' : 'Current week'}
            >
              ●
            </button>
          )}
          <button
            type="button"
            className="dashboard-week-btn"
            onClick={() => github.setWeekOffset(previous => previous + 1)}
            disabled={github.weekOffset >= 0}
            title={isZh ? '下一周' : 'Next week'}
          >
            ›
          </button>
          <Button appearance="subtle" size="small" icon={<Open24Regular />} onClick={() => navigate('/settings')}>
            {copy.openGithub}
          </Button>
        </div>
      </div>

      {github.isLoading ? <PanelSkeleton rows={3} badges /> : github.isConnected ? (
        github.commits.length ? (
          <div className="dashboard-panel-body-with-footer">
            <div className="dashboard-commit-list">
              {github.commits.map(commit => (
                <button
                  type="button"
                  className="dashboard-list-item dashboard-commit-item"
                  key={`${commit.repo}-${commit.sha}`}
                  onClick={() => navigate('/settings', { state: { commit } })}
                >
                  <span className="dashboard-commit-repo">{commit.repo}</span>
                  <div className="dashboard-item-text">
                    <strong className="dashboard-item-title">{commit.message?.split('\n')[0]}</strong>
                    <div className="dashboard-commit-meta">
                      <span className="dashboard-item-sub">{commit.author}</span>
                      {commit.date && (
                        <span className="dashboard-commit-date">
                          {formatCommitDate(commit.date, locale)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {github.totalPages > 1 && (
              <div className="dashboard-panel-footer-pagination">
                <button
                  type="button"
                  className="dashboard-page-btn"
                  disabled={github.page <= 1}
                  onClick={() => github.setPage(page => Math.max(1, page - 1))}
                >
                  ‹
                </button>
                <span className="dashboard-page-num">{github.page} / {github.totalPages}</span>
                <button
                  type="button"
                  className="dashboard-page-btn"
                  disabled={github.page >= github.totalPages}
                  onClick={() => github.setPage(page => Math.min(github.totalPages, page + 1))}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<NoteAdd24Regular />}
            message={copy.noCommits}
            action={copy.openGithub}
            onAction={() => navigate('/settings')}
          />
        )
      ) : (
        <EmptyState
          icon={<NoteAdd24Regular />}
          message={copy.disconnected}
          action={copy.connect}
          onAction={() => navigate('/settings')}
        />
      )}
    </div>
  );
}

export function DashboardSecondaryPanels({
  agenda,
  copy,
  eventDateTime,
  eventTime,
  formatCommitDate,
  formatEmailDate,
  github,
  inbox,
  isZh,
  locale,
  memos,
  navigate,
}) {
  return (
    <>
      <div className="dashboard-column-stack">
        <AgendaPanel
          copy={copy}
          eventDateTime={eventDateTime}
          eventTime={eventTime}
          events={agenda.events}
          isLoading={agenda.isLoading}
          isZh={isZh}
          locale={locale}
          navigate={navigate}
        />
        <InboxPanel
          copy={copy}
          emails={inbox.emails}
          formatEmailDate={formatEmailDate}
          isLoading={inbox.isLoading}
          isZh={isZh}
          locale={locale}
          navigate={navigate}
          unreadCount={inbox.unreadCount}
        />
      </div>
      <div className="dashboard-column-stack">
        <MemosPanel
          copy={copy}
          isLoading={memos.isLoading}
          isZh={isZh}
          memos={memos.items}
          navigate={navigate}
        />
        <GitHubPanel
          copy={copy}
          formatCommitDate={formatCommitDate}
          github={github}
          isZh={isZh}
          locale={locale}
          navigate={navigate}
        />
      </div>
    </>
  );
}
