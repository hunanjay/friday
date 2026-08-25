import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Text } from '@fluentui/react-components';
import {
  Add24Regular,
  CalendarLtr24Regular,
  Checkmark24Regular,
  CheckmarkCircle24Filled,
  Circle24Regular,
  Clock24Regular,
  Delete24Regular,
  Edit24Regular,
  TaskListLtr24Regular,
} from '@fluentui/react-icons';
import { useTodos } from '../useTodos';
import { EmptyState, PanelSkeleton } from './DashboardSecondaryPanels';

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
    const frame = window.requestAnimationFrame(() => {
      const initialControl = dialog?.querySelector('[data-dialog-autofocus]')
        || dialog?.querySelector(focusableSelector);
      initialControl?.focus();
    });
    const handleKeyDown = event => {
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

function handleAutoResize(event, minHeight = 34, maxHeight = 120) {
  const target = event.target;
  target.style.height = 'auto';
  target.style.height = `${Math.min(maxHeight, Math.max(minHeight, target.scrollHeight))}px`;
}

export function DashboardTodoPanel({ copy, isZh }) {
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

  const todosTag = isZh ? `${pendingTodosCount} 待完成` : `${pendingTodosCount} pending`;

  return (
          <div className="dashboard-panel dashboard-todo-panel">
            <div className="dashboard-panel-header">
              <div className="dashboard-panel-title-group">
                <TaskListLtr24Regular className="panel-title-icon" />
                <h2 className="panel-title-text">{copy.todosTitle}</h2>
                <span className="dashboard-panel-tag">{todosTag}</span>
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

  );
}
