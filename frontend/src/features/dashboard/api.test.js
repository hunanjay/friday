import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { createTodo, deleteTodo, getTodos, updateTodo } from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('dashboard API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes todo list fields from the backend contract', async () => {
    apiRequest.mockResolvedValue({
      todos: [{
        id: 'todo-1',
        text: 'Ship it',
        completed: false,
        due_date: '2026-08-26',
        created_at: '2026-08-25T00:00:00Z',
      }],
    });

    await expect(getTodos('token')).resolves.toEqual([
      expect.objectContaining({
        id: 'todo-1',
        dueDate: '2026-08-26',
        createdAt: '2026-08-25T00:00:00Z',
      }),
    ]);
    expect(apiRequest).toHaveBeenCalledWith('/api/todos', { token: 'token' });
  });

  it('uses the shared client for todo create, update, and delete', async () => {
    apiRequest
      .mockResolvedValueOnce({ id: 'todo-2', text: 'New', completed: false })
      .mockResolvedValueOnce({ id: 'todo/2', text: 'Done', completed: true })
      .mockResolvedValueOnce(null);

    await createTodo('token', { text: 'New', dueDate: null });
    await updateTodo('token', {
      id: 'todo/2',
      text: 'Done',
      completed: true,
      dueDate: '2026-08-27',
    });
    await deleteTodo('token', 'todo/2');

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/todos', {
      method: 'POST',
      token: 'token',
      body: { text: 'New', dueDate: null },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/todos/todo%2F2', {
      method: 'PUT',
      token: 'token',
      body: { text: 'Done', completed: true, dueDate: '2026-08-27' },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(3, '/api/todos/todo%2F2', {
      method: 'DELETE',
      token: 'token',
    });
  });
});
