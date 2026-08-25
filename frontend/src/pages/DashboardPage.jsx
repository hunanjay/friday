import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  FluentProvider,
  Text,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import {
  Add24Regular,
  CalendarLtr24Regular,
  Chat24Regular,
  Checkmark24Regular,
  CheckmarkCircle24Filled,
  Circle24Regular,
  Clock24Regular,
  Delete24Regular,
  DocumentBulletList24Regular,
  Edit24Regular,
  Mail24Regular,
  NoteAdd24Regular,
  TaskListLtr24Regular,
} from '@fluentui/react-icons';
import { useAuth } from '../features/auth/useAuth';
import { useCalendarEvents } from '../features/calendar/hooks';
import { useDashboardInbox } from '../features/dashboard/useDashboardInbox';
import {
  DashboardSecondaryPanels,
  EmptyState,
  PanelSkeleton,
} from '../features/dashboard/components/DashboardSecondaryPanels';
import { useTodos } from '../features/dashboard/useTodos';
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

function useDialogFocus(isOpen, onClose) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusInitialControl = () => {
      const initialControl = dialog?.querySelector('[data-dialog-autofocus]') || dialog?.querySelector(focusableSelector);
      initialControl?.focus();
    };
    const frame = window.requestAnimationFrame(focusInitialControl);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const controls = [...dialog.querySelectorAll(focusableSelector)];
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  return dialogRef;
}

function handleAutoResize(e, minHeight = 34, maxHeight = 120) {
  const target = e.target;
  target.style.height = 'auto';
  const newHeight = Math.min(maxHeight, Math.max(minHeight, target.scrollHeight));
  target.style.height = `${newHeight}px`;
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

  // ── Todo List Helpers & State (backend-persisted CRUD) ───────────────────
  const formatTodoCreated = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: DASHBOARD_TIME_ZONE,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.month}/${value.day} ${value.hour}:${value.minute}`;
  };

  const getDueDateStatus = (dueDateStr) => {
    if (!dueDateStr) return null;
    const today = dayKey();
    const tomorrow = shiftDayKey(today, 1);

    const shortDate = dueDateStr.slice(5).replace('-', '/'); // "08/01"

    if (dueDateStr < today) {
      return { label: isZh ? `逾期 ${shortDate}` : `${shortDate}!`, status: 'overdue' };
    }
    if (dueDateStr === today) {
      return { label: isZh ? '今天' : 'Today', status: 'today' };
    }
    if (dueDateStr === tomorrow) {
      return { label: isZh ? '明天' : 'Tmrw', status: 'tomorrow' };
    }
    return { label: shortDate, status: 'future' };
  };

  const {
    clearCompletedTodos,
    createTodo,
    deleteTodo,
    isLoadingTodos: isTodosLoading,
    refetchTodos: loadTodos,
    todos,
    todosError,
    updateTodo,
  } = useTodos();
  const [newTodoText, setNewTodoText] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [todoToEdit, setTodoToEdit] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingDueDate, setEditingDueDate] = useState('');
  const [todoToDelete, setTodoToDelete] = useState(null);

  // Sort Todos: Uncompleted first -> Overdue / Earliest Due Date -> Newest Created
  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      if (a.dueDate && b.dueDate) {
        if (a.dueDate !== b.dueDate) {
          return a.dueDate.localeCompare(b.dueDate);
        }
      } else if (a.dueDate && !b.dueDate) {
        return -1;
      } else if (!a.dueDate && b.dueDate) {
        return 1;
      }
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [todos]);

  const handleModalAddTodo = async (e) => {
    if (e) e.preventDefault();
    if (!newTodoText.trim()) return;
    try {
      await createTodo({ text: newTodoText.trim(), dueDate: newDueDate || null });
      handleCloseAddModal();
    } catch { /* mutation exposes the panel error */ }
  };

  const handleCloseAddModal = () => {
    setIsAddModalOpen(false);
    setNewTodoText('');
    setNewDueDate('');
  };

  const handleToggleTodo = async (id) => {
    const current = todos.find(todo => todo.id === id);
    if (!current) return;
    const optimistic = { ...current, completed: !current.completed };
    try {
      await updateTodo(optimistic);
    } catch { /* the mutation rolls the optimistic state back */ }
  };

  const handleStartEdit = (todo, e) => {
    if (e) e.stopPropagation();
    setTodoToEdit(todo);
    setEditingText(todo.text);
    setEditingDueDate(todo.dueDate || '');
  };

  const handleSaveModalEdit = async (e) => {
    if (e) e.preventDefault();
    if (!todoToEdit || !editingText.trim()) return;
    const optimistic = {
      ...todoToEdit,
      text: editingText.trim(),
      dueDate: editingDueDate || null
    };
    try {
      await updateTodo(optimistic);
      handleCloseEditModal();
    } catch { /* the mutation rolls the optimistic state back */ }
  };

  const handleCloseEditModal = () => {
    setTodoToEdit(null);
    setEditingText('');
    setEditingDueDate('');
  };

  const handleOpenDeleteModal = (todo, e) => {
    if (e) e.stopPropagation();
    setTodoToDelete(todo);
  };

  const handleConfirmDelete = async () => {
    if (!todoToDelete) return;
    try {
      await deleteTodo(todoToDelete.id);
      setTodoToDelete(null);
    } catch { /* the mutation restores the deleted item */ }
  };

  const handleCloseDeleteModal = () => {
    setTodoToDelete(null);
  };

  const addDialogRef = useDialogFocus(isAddModalOpen, handleCloseAddModal);
  const editDialogRef = useDialogFocus(Boolean(todoToEdit), handleCloseEditModal);
  const deleteDialogRef = useDialogFocus(Boolean(todoToDelete), handleCloseDeleteModal);

  const handleClearCompleted = async () => {
    const completed = todos.filter(todo => todo.completed);
    try {
      await clearCompletedTodos(completed);
    } catch { /* successful deletions stay removed and the panel shows an error */ }
  };

  const pendingTodosCount = useMemo(() => todos.filter(t => !t.completed).length, [todos]);
  const completedTodosCount = useMemo(() => todos.filter(t => t.completed).length, [todos]);

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

  const loadError = inboxError || isCalendarError || commitsError;
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
    todosTag: `${pendingTodosCount} 待完成`,
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
    todosTag: `${pendingTodosCount} pending`,
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
            <div className="dashboard-hero-pill" onClick={() => navigate('/settings')} title={copy.commits}>
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
          <div className="dashboard-panel dashboard-todo-panel">
            <div className="dashboard-panel-header">
              <div className="dashboard-panel-title-group">
                <TaskListLtr24Regular className="panel-title-icon" />
                <h2 className="panel-title-text">{copy.todosTitle}</h2>
                <span className="dashboard-panel-tag">{copy.todosTag}</span>
              </div>
              <div className="dashboard-panel-header-actions">
                {completedTodosCount > 0 && (
                  <button
                    type="button"
                    className="dashboard-todo-clear-btn"
                    onClick={handleClearCompleted}
                    title={copy.clearDone}
                  >
                    {copy.clearDone}
                  </button>
                )}
                <Button appearance="primary" size="small" icon={<Add24Regular />} onClick={() => setIsAddModalOpen(true)}>
                  {isZh ? '新建' : 'Add'}
                </Button>
              </div>
            </div>

            {/* Todo Item List */}
            <div className="dashboard-todo-list">
              {isTodosLoading ? <PanelSkeleton rows={3} /> : sortedTodos.length ? (
                sortedTodos.map(todo => {
                  const dueInfo = getDueDateStatus(todo.dueDate);
                  return (
                    <div
                      key={todo.id}
                      className={`dashboard-todo-item ${todo.completed ? 'completed' : ''}`}
                      onClick={() => handleToggleTodo(todo.id)}
                    >
                      <button
                        type="button"
                        className="dashboard-todo-checkbox"
                        onClick={(e) => { e.stopPropagation(); handleToggleTodo(todo.id); }}
                      >
                        {todo.completed ? (
                          <CheckmarkCircle24Filled className="todo-check-icon checked" />
                        ) : (
                          <Circle24Regular className="todo-check-icon" />
                        )}
                      </button>

                      <div className="dashboard-todo-content">
                        <span className="dashboard-todo-text">{todo.text}</span>
                        {todo.createdAt && (
                          <div className="dashboard-todo-meta">
                            <span className="todo-meta-item created" title={isZh ? '创建时间' : 'Creation time'}>
                              <Clock24Regular className="meta-icon" />
                              <span>{formatTodoCreated(todo.createdAt)}</span>
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="dashboard-todo-right-slot">
                        {dueInfo && (
                          <div className="todo-due-badge-slot">
                            <span className={`todo-meta-item due-badge ${dueInfo.status}`} title={isZh ? '截止日期' : 'Due date'}>
                              <CalendarLtr24Regular className="meta-icon" />
                              <span>{dueInfo.label}</span>
                            </span>
                          </div>
                        )}

                        <div className="dashboard-todo-actions">
                          <button
                            type="button"
                            className="dashboard-todo-action-icon edit"
                            onClick={(e) => handleStartEdit(todo, e)}
                            title={isZh ? '编辑' : 'Edit task'}
                          >
                            <Edit24Regular />
                          </button>
                          <button
                            type="button"
                            className="dashboard-todo-action-icon del"
                            onClick={(e) => handleOpenDeleteModal(todo, e)}
                            title={isZh ? '删除' : 'Delete task'}
                          >
                            <Delete24Regular />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState icon={<TaskListLtr24Regular />} message={copy.noTodos} action={isZh ? '新建待办' : 'Add Task'} onAction={() => setIsAddModalOpen(true)} />
              )}
            </div>
            {todosError && (
              <div className="dashboard-todo-error" role="status">
                <Text>{isZh ? '待办同步失败' : 'Could not sync tasks'}</Text>
                <Button appearance="subtle" size="small" onClick={() => loadTodos()}>{copy.retry}</Button>
              </div>
            )}

            {/* New Task Modal */}
            {isAddModalOpen && (
              <div className="dashboard-modal-overlay" onClick={handleCloseAddModal}>
                <div ref={addDialogRef} className="dashboard-modal-card add-task-card" role="dialog" aria-modal="true" aria-labelledby="dashboard-add-task-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
                  <h3 id="dashboard-add-task-title" className="dashboard-modal-title">{isZh ? '新建待办事项' : 'New Task'}</h3>
                  <form onSubmit={handleModalAddTodo} className="dashboard-modal-form">
                    <div className="dashboard-todo-input-wrap">
                      <textarea
                        value={newTodoText}
                        onChange={(e) => {
                          setNewTodoText(e.target.value);
                          handleAutoResize(e, 200, 340);
                        }}
                        maxLength={100}
                        data-dialog-autofocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleModalAddTodo(e);
                          }
                        }}
                        placeholder={copy.addTodoPlaceholder}
                        className="dashboard-todo-input modal-textarea"
                        rows={6}
                      />
                      {newTodoText.length > 0 && (
                        <span className={`todo-char-counter ${newTodoText.length >= 90 ? 'warning' : ''}`}>
                          {newTodoText.length}/100
                        </span>
                      )}
                    </div>

                    <div className="dashboard-modal-due-row">
                      <label className="modal-field-label">
                        <CalendarLtr24Regular className="field-icon" />
                        <span>{isZh ? '截止日期' : 'Due Date'}</span>
                      </label>
                      <input
                        type="date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        className="modal-date-input"
                      />
                      <div className="modal-date-presets">
                        <button
                          type="button"
                          className={`preset-chip ${newDueDate === dayKey() ? 'active' : ''}`}
                          onClick={() => setNewDueDate(dayKey())}
                        >
                          {isZh ? '今天' : 'Today'}
                        </button>
                        <button
                          type="button"
                          className={`preset-chip ${newDueDate === shiftDayKey(dayKey(), 1) ? 'active' : ''}`}
                          onClick={() => setNewDueDate(shiftDayKey(dayKey(), 1))}
                        >
                          {isZh ? '明天' : 'Tomorrow'}
                        </button>
                        {newDueDate && (
                          <button
                            type="button"
                            className="preset-chip clear"
                            onClick={() => setNewDueDate('')}
                          >
                            {isZh ? '清除' : 'Clear'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="dashboard-modal-footer">
                      <button
                        type="button"
                        className="modal-btn-cancel"
                        onClick={handleCloseAddModal}
                      >
                        {isZh ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="submit"
                        className="modal-btn-primary"
                        disabled={!newTodoText.trim()}
                      >
                        <Add24Regular />
                        <span>{isZh ? '添加待办' : 'Add Task'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Edit Task Modal */}
            {todoToEdit && (
              <div className="dashboard-modal-overlay" onClick={handleCloseEditModal}>
                <div ref={editDialogRef} className="dashboard-modal-card add-task-card" role="dialog" aria-modal="true" aria-labelledby="dashboard-edit-task-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
                  <h3 id="dashboard-edit-task-title" className="dashboard-modal-title">{isZh ? '编辑待办事项' : 'Edit Task'}</h3>
                  <form onSubmit={handleSaveModalEdit} className="dashboard-modal-form">
                    <div className="dashboard-todo-input-wrap">
                      <textarea
                        value={editingText}
                        onChange={(e) => {
                          setEditingText(e.target.value);
                          handleAutoResize(e, 200, 340);
                        }}
                        maxLength={100}
                        data-dialog-autofocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSaveModalEdit(e);
                          }
                        }}
                        placeholder={copy.addTodoPlaceholder}
                        className="dashboard-todo-input modal-textarea"
                        rows={6}
                      />
                      {editingText.length > 0 && (
                        <span className={`todo-char-counter ${editingText.length >= 90 ? 'warning' : ''}`}>
                          {editingText.length}/100
                        </span>
                      )}
                    </div>

                    <div className="dashboard-modal-due-row">
                      <label className="modal-field-label">
                        <CalendarLtr24Regular className="field-icon" />
                        <span>{isZh ? '截止日期' : 'Due Date'}</span>
                      </label>
                      <input
                        type="date"
                        value={editingDueDate}
                        onChange={(e) => setEditingDueDate(e.target.value)}
                        className="modal-date-input"
                      />
                      <div className="modal-date-presets">
                        <button
                          type="button"
                          className={`preset-chip ${editingDueDate === dayKey() ? 'active' : ''}`}
                          onClick={() => setEditingDueDate(dayKey())}
                        >
                          {isZh ? '今天' : 'Today'}
                        </button>
                        <button
                          type="button"
                          className={`preset-chip ${editingDueDate === shiftDayKey(dayKey(), 1) ? 'active' : ''}`}
                          onClick={() => setEditingDueDate(shiftDayKey(dayKey(), 1))}
                        >
                          {isZh ? '明天' : 'Tomorrow'}
                        </button>
                        {editingDueDate && (
                          <button
                            type="button"
                            className="preset-chip clear"
                            onClick={() => setEditingDueDate('')}
                          >
                            {isZh ? '清除' : 'Clear'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="dashboard-modal-footer">
                      <button
                        type="button"
                        className="modal-btn-cancel"
                        onClick={handleCloseEditModal}
                      >
                        {isZh ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="submit"
                        className="modal-btn-primary"
                        disabled={!editingText.trim()}
                      >
                        <Checkmark24Regular />
                        <span>{isZh ? '保存修改' : 'Save Changes'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Delete Confirmation Modal */}
            {todoToDelete && (
              <div className="dashboard-modal-overlay" onClick={handleCloseDeleteModal}>
                <div ref={deleteDialogRef} className="dashboard-modal-card delete-task-card" role="alertdialog" aria-modal="true" aria-labelledby="dashboard-delete-task-title" aria-describedby="dashboard-delete-task-description" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
                  <h3 id="dashboard-delete-task-title" className="dashboard-modal-title">{isZh ? '确认删除待办事项？' : 'Delete Task?'}</h3>
                  <p id="dashboard-delete-task-description" className="dashboard-modal-subtitle">
                    {isZh ? '确认要删除以下待办事项吗？此操作无法撤销。' : 'Are you sure you want to delete this task? This action cannot be undone.'}
                  </p>
                  <div className="dashboard-modal-preview">
                    "{todoToDelete.text}"
                  </div>
                  <div className="dashboard-modal-footer">
                    <button
                      type="button"
                        className="modal-btn-cancel"
                        data-dialog-autofocus
                      onClick={handleCloseDeleteModal}
                    >
                      {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      className="modal-btn-danger"
                      onClick={handleConfirmDelete}
                    >
                      <Delete24Regular />
                      <span>{isZh ? '确认删除' : 'Delete'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

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
