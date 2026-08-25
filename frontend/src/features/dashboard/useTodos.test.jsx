import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useTodos } from './useTodos';

const apiMocks = vi.hoisted(() => ({
  createTodo: vi.fn(),
  deleteTodo: vi.fn(),
  getTodos: vi.fn(),
  updateTodo: vi.fn(),
}));

vi.mock('./api', () => apiMocks);

function TodosProbe({ id, controls = false }) {
  const todos = useTodos();
  return (
    <div>
      <span data-testid={id}>
        {todos.todos.map(todo => `${todo.id}:${todo.text}:${todo.completed}`).join(',')}
      </span>
      {controls && (
        <>
          <button onClick={() => void todos.createTodo({ text: 'Second' })}>create</button>
          <button onClick={() => void todos.updateTodo({
            id: 'todo-1',
            text: 'First',
            completed: true,
          })}>toggle</button>
          <button onClick={() => void todos.deleteTodo('todo-2')}>delete</button>
        </>
      )}
    </div>
  );
}

describe('useTodos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTodos.mockResolvedValue([
      { id: 'todo-1', text: 'First', completed: false },
    ]);
    apiMocks.createTodo.mockResolvedValue({ id: 'todo-2', text: 'Second', completed: false });
    apiMocks.updateTodo.mockResolvedValue({ id: 'todo-1', text: 'First', completed: true });
    apiMocks.deleteTodo.mockResolvedValue(null);
  });

  it('deduplicates loading and synchronizes optimistic CRUD across consumers', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', user: { id: 'user-1' } };
    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <TodosProbe id="first" controls />
          <TodosProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('todo-1:First:false'));
    expect(apiMocks.getTodos).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('todo-2:Second:false'));
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('todo-1:First:true'));
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(screen.getByTestId('first')).not.toHaveTextContent('todo-2'));

    expect(apiMocks.createTodo).toHaveBeenCalledWith('token', { text: 'Second' });
    expect(apiMocks.updateTodo).toHaveBeenCalledWith('token', expect.objectContaining({
      id: 'todo-1',
      completed: true,
    }));
    expect(apiMocks.deleteTodo).toHaveBeenCalledWith('token', 'todo-2');
  });
});
