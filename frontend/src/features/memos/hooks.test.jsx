import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useMemos } from './hooks';

const apiMocks = vi.hoisted(() => ({
  createMemo: vi.fn(),
  deleteMemo: vi.fn(),
  getMemos: vi.fn(),
  updateMemo: vi.fn(),
}));

vi.mock('./api', () => ({
  createMemo: apiMocks.createMemo,
  deleteMemo: apiMocks.deleteMemo,
  getMemos: apiMocks.getMemos,
  updateMemo: apiMocks.updateMemo,
  uploadMemoAttachment: vi.fn(),
}));

function MemosProbe({ id, controls = false }) {
  const { memos, addMemo, updateMemo, deleteMemo } = useMemos();
  return (
    <div>
      <span data-testid={id}>{memos.map(memo => `${memo.id}:${memo.title}`).join(',')}</span>
      {controls && (
        <>
          <button onClick={() => addMemo({ title: 'Second' })}>add</button>
          <button onClick={() => updateMemo({ id: 'memo-1', title: 'Updated' })}>update</button>
          <button onClick={() => deleteMemo('memo-2')}>delete</button>
        </>
      )}
    </div>
  );
}

describe('memos hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getMemos.mockResolvedValue([{ id: 'memo-1', title: 'First' }]);
    apiMocks.createMemo.mockResolvedValue({ id: 'memo-2', title: 'Second' });
    apiMocks.updateMemo.mockResolvedValue({ id: 'memo-1', title: 'Updated' });
    apiMocks.deleteMemo.mockResolvedValue('memo-2');
  });

  it('deduplicates loading and synchronizes CRUD mutations across consumers', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', user: { email: 'person@example.com' } };

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <MemosProbe id="first" controls />
          <MemosProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('memo-1:First'));
    expect(apiMocks.getMemos).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('memo-2:Second,memo-1:First'));

    fireEvent.click(screen.getByRole('button', { name: 'update' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('memo-1:Updated'));

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(screen.getByTestId('first')).not.toHaveTextContent('memo-2'));
    expect(apiMocks.createMemo).toHaveBeenCalledWith('token', { title: 'Second' });
    expect(apiMocks.updateMemo).toHaveBeenCalledWith('token', { id: 'memo-1', title: 'Updated' });
    expect(apiMocks.deleteMemo).toHaveBeenCalledWith('token', 'memo-2');
  });
});
