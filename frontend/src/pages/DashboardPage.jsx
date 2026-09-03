import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  FluentProvider,
  Text,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import { Chat24Regular } from '@fluentui/react-icons';
import { useAuth } from '../features/auth/useAuth';
import { useCalendarEvents } from '../features/calendar/hooks';
import { useDashboardInbox } from '../features/dashboard/useDashboardInbox';
import {
  DashboardBubbleField,
  DashboardSecondaryPanels,
} from '../features/dashboard/components/DashboardSecondaryPanels';
import { DashboardTodoPanel } from '../features/dashboard/components/DashboardTodoPanel';
import { useGitHubCommits, useGitHubConnection } from '../features/github/hooks';
import { useInboxUnread, useMailMessages } from '../features/mail/mailboxHooks';
import { useAssistantName } from '../features/settings/hooks';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import './DashboardPage.css';

const doraLightTheme = {
  ...webLightTheme,
  colorBrandBackground: '#B64E30',
  colorBrandBackgroundHover: '#9D4027',
  colorBrandBackgroundPressed: '#83331F',
  colorBrandForeground1: '#A54429',
  colorBrandForegroundLink: '#9D4027',
  colorBrandStroke1: '#B64E30',
  colorCompoundBrandBackground: '#B64E30',
  colorCompoundBrandBackgroundHover: '#9D4027',
  colorCompoundBrandBackgroundPressed: '#83331F',
};

const doraDarkTheme = {
  ...webDarkTheme,
  // Solid-fill button backgrounds need to stay dark enough for white button
  // text to clear WCAG AA (4.5:1) - the old #E27E5B was picked to be
  // visible against the dark app background, but that made white text on
  // top of it (e.g. the primary "+新建" button) drop to ~2.85:1. Text/link/
  // stroke uses below are a different pairing (bright color on the dark
  // neutral background, not white-on-brand) and were already fine.
  colorBrandBackground: '#B24A2E',
  colorBrandBackgroundHover: '#A5432A',
  colorBrandBackgroundPressed: '#963D25',
  colorBrandForeground1: '#F09675',
  colorBrandForegroundLink: '#F09675',
  colorBrandStroke1: '#E27E5B',
  colorCompoundBrandBackground: '#B24A2E',
  colorCompoundBrandBackgroundHover: '#A5432A',
  colorCompoundBrandBackgroundPressed: '#963D25',
};

const DASHBOARD_TIME_ZONE = 'Asia/Shanghai';

function dayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDayKey(dateKey, offsetDays) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

function eventDateTime(event) {
  return event?.start?.dateTime || event?.startDateTime || '';
}

function eventTime(event, locale) {
  const value = eventDateTime(event);
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value.slice(11, 16);
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DASHBOARD_TIME_ZONE,
  }).format(parsed);
}

function formatEmailDate(dateStr, locale) {
  if (!dateStr) return '';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.valueOf())) return '';
  const isToday = dayKey(parsed) === dayKey();
  if (isToday) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DASHBOARD_TIME_ZONE }).format(parsed);
  }
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', timeZone: DASHBOARD_TIME_ZONE }).format(parsed);
}

function formatCommitDate(dateStr, locale) {
  if (!dateStr) return '';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.valueOf())) return '';
  const isToday = dayKey(parsed) === dayKey();
  return new Intl.DateTimeFormat(locale, {
    month: isToday ? undefined : 'numeric',
    day: isToday ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DASHBOARD_TIME_ZONE,
  }).format(parsed);
}

function getWeekWindow(offsetWeeks = 0) {
  const todayKey = dayKey();
  const [year, month, day] = todayKey.split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = today.getUTCDay();
  const distanceToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek) + (offsetWeeks * 7);

  const mondayKey = shiftDayKey(todayKey, distanceToMonday);
  const sundayKey = shiftDayKey(mondayKey, 6);
  const [mondayMonth, mondayDay] = mondayKey.split('-').slice(1).map(Number);
  const [sundayMonth, sundayDay] = sundayKey.split('-').slice(1).map(Number);

  return {
    since: new Date(`${mondayKey}T00:00:00+08:00`).toISOString(),
    until: new Date(`${sundayKey}T23:59:59.999+08:00`).toISOString(),
    mondayStr: `${mondayMonth}.${mondayDay}`,
    sundayStr: `${sundayMonth}.${sundayDay}`,
  };
}

function displayName(user) {
  return user?.name?.trim()?.split(/\s+/)[0] || '';
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { theme } = useTheme();
  const { assistantName } = useAssistantName();
  const { githubStatus } = useGitHubConnection();
  const { emails } = useMailMessages();
  const { inboxUnread } = useInboxUnread();
  const { user } = useAuth();
  const isZh = i18n.language === 'zh';
  const [composerText, setComposerText] = useState('');

  // ── Independent panel queries ────────────────────────────────────────────
  const dashboardCalendarRange = useMemo(() => {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);
  const {
    events,
    isCalendarError,
    isLoadingCalendarEvents,
    refetchCalendarEvents,
  } = useCalendarEvents(dashboardCalendarRange);
  const {
    inboxError,
    isLoadingInbox: isEmailsLoading,
    refetchInbox,
  } = useDashboardInbox();

  // ── GitHub commits, current week only - the dashboard ticker is ambient,
  // not a browsable archive, so there's no week-nav/pagination to maintain.
  const currentWeekInfo = useMemo(() => getWeekWindow(0), []);
  const {
    commits,
    commitsError,
    isLoadingCommits: isCommitsLoading,
    refetchCommits,
  } = useGitHubCommits(currentWeekInfo);

  // A commits fetch error is expected (a 404) when GitHub simply isn't
  // connected - the GitHub panel already shows its own "not connected"
  // state for that, so it shouldn't also trip the page-level error banner.
  const loadError = inboxError || isCalendarError || (commitsError && githubStatus?.connected);
  const handleRetry = () => {
    void refetchCalendarEvents();
    void refetchInbox();
    void refetchCommits();
  };

  const todayEvents = useMemo(() => events
    .filter(event => eventDateTime(event).slice(0, 10) === dayKey())
    .sort((a, b) => eventDateTime(a).localeCompare(eventDateTime(b))), [events]);
  const upcomingEvents = useMemo(() => events
    .filter(event => eventDateTime(event) >= new Date().toISOString())
    .sort((a, b) => eventDateTime(a).localeCompare(eventDateTime(b)))
    .slice(0, 4), [events]);
  const displayEmails = useMemo(() => {
    const unread = emails.filter(email => email.parentFolderId === 'inbox' && !email.isRead);
    if (unread.length > 0) return unread.slice(0, 4);
    return emails.filter(email => email.parentFolderId === 'inbox').slice(0, 4);
  }, [emails]);
  const copy = isZh ? {
    greeting: `早上好，${displayName(user) || '朋友'}`,
    date: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()),
    summary: '今日概览',
    askDora: `问问 ${assistantName}`,
    composerPlaceholder: `问问 ${assistantName}：今天有什么该注意的？`,
    unread: '未读邮件',
    meetings: '今日日程',
    commits: '次提交',
    todosTitle: '待办事项',
    addTodoPlaceholder: '添加新的待办事项...',
    noTodos: '暂无待办事项',
    filterAll: '全部',
    filterPending: '未完成',
    filterDone: '已完成',
    clearDone: '清除已完成',
    githubTitle: 'GitHub 动态',
    openGithub: 'GitHub',
    noCommits: '暂无提交记录',
    disconnected: '未连接 GitHub',
    error: '部分数据未更新',
    retry: '刷新',
    allDay: '全天',
    connect: '连接',
    radarTitle: '关系雷达',
    radarPreviewTag: '概念预览',
    radarPreviewCopy: '即将推出：在合适的时机，主动提醒你该联系哪些人。',
    bubbleFieldLabel: '邮件 · 日程速览',
  } : {
    greeting: `Good morning, ${displayName(user) || 'there'}`,
    date: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()),
    summary: 'Today\'s overview',
    askDora: `Ask ${assistantName}`,
    composerPlaceholder: `Ask ${assistantName}: what should I keep in mind today?`,
    unread: 'Unread mail',
    meetings: 'Events today',
    commits: 'commits',
    todosTitle: 'To-Do List',
    addTodoPlaceholder: 'Add a new task...',
    noTodos: 'No tasks yet',
    filterAll: 'All',
    filterPending: 'Pending',
    filterDone: 'Done',
    clearDone: 'Clear Done',
    githubTitle: 'GitHub activity',
    openGithub: 'GitHub',
    noCommits: 'No commits today',
    disconnected: 'Not connected',
    error: 'Partial sync error',
    retry: 'Refresh',
    allDay: 'All day',
    connect: 'Connect',
    radarTitle: 'Relationship Radar',
    radarPreviewTag: 'Concept preview',
    radarPreviewCopy: 'Coming soon: proactive nudges for who to reach out to, at the right time.',
    bubbleFieldLabel: 'Mail · Calendar at a glance',
  };

  const unreadCount = inboxUnread ?? displayEmails.filter(e => !e.isRead).length;

  return (
    <FluentProvider theme={theme === 'dark' ? doraDarkTheme : doraLightTheme} className="dashboard-fluent">
      <div className="dashboard-page">
        {/* ── Command bar ── */}
        <header className="dashboard-hero-header">
          <div className="dashboard-hero-left">
            <Text as="p" className="dashboard-date">{copy.date}</Text>
            <h1>{copy.greeting}</h1>
            <p className="dashboard-glance-line">
              <b>{unreadCount}</b> {copy.unread}
              {' · '}
              <b>{todayEvents.length}</b> {copy.meetings}
            </p>
          </div>

          <form
            className="dashboard-hero-actions"
            onSubmit={(e) => { e.preventDefault(); navigate('/chat'); }}
          >
            <input
              type="text"
              className="dashboard-composer-input"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              placeholder={copy.composerPlaceholder}
            />
            <button type="submit" className="dashboard-composer-send" aria-label={copy.askDora}>
              <Chat24Regular />
            </button>
          </form>
        </header>

        {loadError && (
          <div className="dashboard-error" role="status">
            <Text>{copy.error}</Text>
            <Button appearance="subtle" onClick={handleRetry}>{copy.retry}</Button>
          </div>
        )}

        {/* ── Priority feed + side column ── */}
        <main className="dashboard-workspace-grid">
          <div className="dashboard-column-stack">
            <DashboardTodoPanel copy={copy} isZh={isZh} />
            <DashboardBubbleField
              copy={copy}
              eventTime={eventTime}
              events={isLoadingCalendarEvents ? [] : upcomingEvents}
              emails={isEmailsLoading ? [] : displayEmails}
              formatEmailDate={formatEmailDate}
              isZh={isZh}
              locale={i18n.language}
              navigate={navigate}
            />
          </div>

          <DashboardSecondaryPanels
            copy={copy}
            formatCommitDate={formatCommitDate}
            github={{
              commits,
              isConnected: Boolean(githubStatus?.connected),
              isLoading: isCommitsLoading,
            }}
            locale={i18n.language}
            navigate={navigate}
          />
        </main>
      </div>
    </FluentProvider>
  );
}
