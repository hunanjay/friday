import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardTodoPanel } from './DashboardTodoPanel';

const todosState = vi.hoisted(() => ({
  clearCompletedTodos: vi.fn(),
  createTodo: vi.fn(),
  deleteTodo: vi.fn(),
  isLoadingTodos: false,
  refetchTodos: vi.fn(),
  todos: [],
  todosError: false,
  updateTodo: vi.fn(),
}));

vi.mock('../useTodos', () => ({
  useTodos: () => todosState,
}));

const copy = {
  todosTitle: 'To-Do List',
  addTodoPlaceholder: 'Add a new task...',
  noTodos: 'No tasks yet',
  clearDone: 'Clear Done',
  retry: 'Refresh',
};

function renderPanel() {
  return render(<DashboardTodoPanel copy={copy} isZh={false} />);
}

describe('DashboardTodoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    todosState.isLoadingTodos = false;
    todosState.todosError = false;
    todosState.todos = [];
  });

  it('shows the empty state when there are no todos', () => {
    renderPanel();
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
  });

  it('lists todos and toggles completion on click', async () => {
    todosState.todos = [
      { id: '1', text: 'Write report', completed: false, dueDate: null, createdAt: null },
    ];
    renderPanel();

    expect(screen.getByText('Write report')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Write report'));
    await waitFor(() => expect(todosState.updateTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', completed: true }),
    ));
  });

  it('creates a todo through the add-task modal', async () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByPlaceholderText('Add a new task...'), {
      target: { value: 'Buy milk' },
    });
    fireEvent.click(container.querySelector('.modal-btn-primary'));

    await waitFor(() => expect(todosState.createTodo).toHaveBeenCalledWith({
      text: 'Buy milk',
      dueDate: null,
    }));
  });

  it('deletes a todo after confirming the delete modal', async () => {
    todosState.todos = [
      { id: '1', text: 'Write report', completed: false, dueDate: null, createdAt: null },
    ];
    renderPanel();

    fireEvent.click(screen.getByTitle('Delete task'));
    expect(screen.getByText('Delete Task?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(todosState.deleteTodo).toHaveBeenCalledWith('1'));
  });

  it('surfaces a sync error with a retry action', () => {
    todosState.todosError = true;
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(todosState.refetchTodos).toHaveBeenCalled();
  });
});
