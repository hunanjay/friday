import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  FluentProvider,
  Text,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import {
  CalendarLtr24Regular,
  Chat24Regular,
  DocumentBulletList24Regular,
  Mail24Regular,
  NoteAdd24Regular,
} from '@fluentui/react-icons';
import { useAuth } from '../features/auth/useAuth';
import { useCalendarEvents } from '../features/calendar/hooks';
import { useDashboardInbox } from '../features/dashboard/useDashboardInbox';
import {
  DashboardSecondaryPanels,
} from '../features/dashboard/components/DashboardSecondaryPanels';
import { DashboardTodoPanel } from '../features/dashboard/components/DashboardTodoPanel';
import { useGitHubCommits, useGitHubConnection } from '../features/github/hooks';
import { useInboxUnread, useMailMessages } from '../features/mail/mailboxHooks';
import { useMemos } from '../features/memos/hooks';
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
  colorBrandBackground: '#E27E5B',
  colorBrandBackgroundHover: '#F09675',
  colorBrandBackgroundPressed: '#C96648',
  colorBrandForeground1: '#F09675',
  colorBrandForegroundLink: '#F09675',
  colorBrandStroke1: '#E27E5B',
  colorCompoundBrandBackground: '#E27E5B',
  colorCompoundBrandBackgroundHover: '#F09675',
  colorCompoundBrandBackgroundPressed: '#C96648',
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
  const { memos, isLoadingMemos } = useMemos();
  const { user } = useAuth();
  const isZh = i18n.language === 'zh';

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

  // ── GitHub Commits Week Window & Pagination ──────────────────────────────
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, -1 = last week
  const [commitsPage, setCommitsPage] = useState(1);
  const commitsPerPage = 3;
  const currentWeekInfo = useMemo(() => getWeekWindow(weekOffset), [weekOffset]);
  const {
    commits,
    commitsError,
    isLoadingCommits: isCommitsLoading,
    refetchCommits,
  } = useGitHubCommits(currentWeekInfo);
  useEffect(() => setCommitsPage(1), [currentWeekInfo]);

  // A commits fetch error is expected (a 404) when GitHub simply isn't
  // connected - the GitHub panel already shows its own "not connected"
  // state for that, so it shouldn't also trip the page-level error banner.
  const loadError = inboxError || isCalendarError || (commitsError && githubStatus?.connected);
  const handleRetry = () => {
    void refetchCalendarEvents();
    void refetchInbox();
    void refetchCommits();
  };

  const totalCommitPages = useMemo(() => Math.max(1, Math.ceil(commits.length / commitsPerPage)), [commits]);
  const pagedCommits = useMemo(() => {
    const start = (commitsPage - 1) * commitsPerPage;
    return commits.slice(start, start + commitsPerPage);
  }, [commits, commitsPage]);

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
  const relevantMemos = useMemo(() => [...memos]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 3), [memos]);

  const copy = isZh ? {
    greeting: `早上好，${displayName(user) || '朋友'}`,
    date: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()),
    summary: '今日概览',
    askDora: `问问 ${assistantName}`,
    unread: '未读邮件',
    meetings: '今日日程',
    notes: '便签',
    commits: '今日提交',
    todosTitle: '待办事项',
    addTodoPlaceholder: '添加新的待办事项...',
    noTodos: '暂无待办事项',
    filterAll: '全部',
    filterPending: '未完成',
    filterDone: '已完成',
    clearDone: '清除已完成',
    agenda: '接下来的日程',
    inbox: '需要留意的邮件',
    memoTitle: '最近便签',
    githubTitle: 'GitHub 动态',
    openCalendar: '日历',
    openEmail: '邮箱',
    openMemos: '便签',
    openGithub: 'GitHub',
    noEvents: '未来 7 天暂无日程',
    noEmails: '收件箱无未读邮件',
    noMemos: '暂无便签',
    noCommits: '暂无提交记录',
    disconnected: '未连接 GitHub',
    error: '部分数据未更新',
    retry: '刷新',
    allDay: '全天',
    connect: '连接',
  } : {
    greeting: `Good morning, ${displayName(user) || 'there'}`,
    date: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()),
    summary: 'Today\'s overview',
    askDora: `Ask ${assistantName}`,
    unread: 'Unread mail',
    meetings: 'Events today',
    notes: 'Memos',
    commits: 'Commits',
    todosTitle: 'To-Do List',
    addTodoPlaceholder: 'Add a new task...',
    noTodos: 'No tasks yet',
    filterAll: 'All',
    filterPending: 'Pending',
    filterDone: 'Done',
    clearDone: 'Clear Done',
    agenda: 'Coming up',
    inbox: 'Inbox notice',
    memoTitle: 'Recent notes',
    githubTitle: 'GitHub activity',
    openCalendar: 'Calendar',
    openEmail: 'Inbox',
    openMemos: 'Memos',
    openGithub: 'GitHub',
    noEvents: 'No upcoming events',
    noEmails: 'Inbox clear',
    noMemos: 'No notes yet',
    noCommits: 'No commits today',
    disconnected: 'Not connected',
    error: 'Partial sync error',
    retry: 'Refresh',
    allDay: 'All day',
    connect: 'Connect',
  };

  const unreadCount = inboxUnread ?? displayEmails.filter(e => !e.isRead).length;

  return (
    <FluentProvider theme={theme === 'dark' ? doraDarkTheme : doraLightTheme} className="dashboard-fluent">
      <div className="dashboard-page">
        {/* ── Top Executive Hero Header ── */}
        <header className="dashboard-hero-header">
          <div className="dashboard-hero-left">
            <Text as="p" className="dashboard-date">{copy.date}</Text>
            <h1>{copy.greeting}</h1>
          </div>

          <div className="dashboard-hero-metrics">
            <div className="dashboard-hero-pill" onClick={() => navigate('/email')} title={copy.unread}>
              <Mail24Regular />
              <span className="metric-num">{unreadCount}</span>
              <span className="metric-label">{copy.unread}</span>
            </div>
            <div className="dashboard-hero-pill" onClick={() => navigate('/calendar')} title={copy.meetings}>
              <CalendarLtr24Regular />
              <span className="metric-num">{todayEvents.length}</span>
              <span className="metric-label">{copy.meetings}</span>
            </div>
            <div className="dashboard-hero-pill" onClick={() => navigate('/memos')} title={copy.notes}>
              <DocumentBulletList24Regular />
              <span className="metric-num">{memos.length}</span>
              <span className="metric-label">{copy.notes}</span>
            </div>
            <div className="dashboard-hero-pill" onClick={() => navigate('/settings/github')} title={copy.commits}>
              <NoteAdd24Regular />
              <span className="metric-num">{commits.length}</span>
              <span className="metric-label">{copy.commits}</span>
            </div>
          </div>

          <div className="dashboard-hero-actions">
            <Button appearance="primary" size="medium" icon={<Chat24Regular />} onClick={() => navigate('/chat')}>
              {copy.askDora}
            </Button>
          </div>
        </header>

        {loadError && (
          <div className="dashboard-error" role="status">
            <Text>{copy.error}</Text>
            <Button appearance="subtle" onClick={handleRetry}>{copy.retry}</Button>
          </div>
        )}

        {/* ── 3-Column Asymmetric Workspace Grid ── */}
        <main className="dashboard-workspace-grid">
          {/* ── COLUMN 1: TODO LIST (Rich Interactive Task Manager) ── */}
          <DashboardTodoPanel copy={copy} isZh={isZh} />

          <DashboardSecondaryPanels
            agenda={{ events: upcomingEvents, isLoading: isLoadingCalendarEvents }}
            copy={copy}
            eventDateTime={eventDateTime}
            eventTime={eventTime}
            formatCommitDate={formatCommitDate}
            formatEmailDate={formatEmailDate}
            github={{
              commits: pagedCommits,
              isConnected: Boolean(githubStatus?.connected),
              isLoading: isCommitsLoading,
              page: commitsPage,
              setPage: setCommitsPage,
              setWeekOffset,
              totalPages: totalCommitPages,
              weekInfo: currentWeekInfo,
              weekOffset,
            }}
            inbox={{
              emails: displayEmails,
              isLoading: isEmailsLoading,
              unreadCount,
            }}
            isZh={isZh}
            locale={i18n.language}
            memos={{ items: relevantMemos, isLoading: isLoadingMemos }}
            navigate={navigate}
          />
        </main>
      </div>
    </FluentProvider>
  );
}
