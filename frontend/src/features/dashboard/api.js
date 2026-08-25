import { apiRequest } from '../../api/client';

export function normalizeTodo(todo) {
  return {
    id: todo.id,
    text: todo.text,
    completed: todo.completed,
    dueDate: todo.due_date ?? todo.dueDate ?? null,
    createdAt: todo.created_at ?? todo.createdAt,
    updatedAt: todo.updated_at ?? todo.updatedAt,
  };
}

export async function getTodos(token) {
  const data = await apiRequest('/api/todos', { token });
  return (data.todos || []).map(normalizeTodo);
}

export async function createTodo(token, { text, dueDate = null }) {
  const data = await apiRequest('/api/todos', {
    method: 'POST',
    token,
    body: { text, dueDate },
  });
  return normalizeTodo(data);
}

export async function updateTodo(token, todo) {
  const data = await apiRequest(`/api/todos/${encodeURIComponent(todo.id)}`, {
    method: 'PUT',
    token,
    body: {
      text: todo.text,
      completed: todo.completed,
      dueDate: todo.dueDate,
    },
  });
  return normalizeTodo(data);
}

export function deleteTodo(token, todoId) {
  return apiRequest(`/api/todos/${encodeURIComponent(todoId)}`, {
    method: 'DELETE',
    token,
  });
}
