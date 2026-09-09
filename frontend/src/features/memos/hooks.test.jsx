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

function MemosProbe({ category = 'all', search = '', controls = false }) {
  const { memos, hasMore, page, goToNextPage, goToPrevPage, addMemo, updateMemo, deleteMemo } = useMemos({
    category,
    search,
    debounceMs: 0,
  });
  return (
    <div>
      <span data-testid="memos">{memos.map(memo => `${memo.id}:${memo.title}`).join(',')}</span>
      <span data-testid="page">{page}</span>
      <span data-testid="hasMore">{String(hasMore)}</span>
      {controls && (
        <>
          <button onClick={() => addMemo({ title: 'Second' })}>add</button>
          <button onClick={() => updateMemo({ id: 'memo-1', title: 'Updated' })}>update</button>
          <button onClick={() => deleteMemo('memo-2')}>delete</button>
          <button onClick={goToNextPage}>next</button>
          <button onClick={goToPrevPage}>prev</button>
        </>
      )}
    </div>
  );
}

function renderWithClient(children) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const auth = { authToken: 'token', user: { email: 'person@example.com' } };
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('memos hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getMemos.mockResolvedValue({ memos: [{ id: 'memo-1', title: 'First' }], hasMore: true });
    apiMocks.createMemo.mockResolvedValue({ id: 'memo-2', title: 'Second' });
    apiMocks.updateMemo.mockResolvedValue({ id: 'memo-1', title: 'Updated' });
    apiMocks.deleteMemo.mockResolvedValue('memo-2');
  });

  it('loads the first page for the given category/search filter', async () => {
    renderWithClient(<MemosProbe category="work" search="q" />);

    await waitFor(() => expect(screen.getByTestId('memos')).toHaveTextContent('memo-1:First'));
    expect(screen.getByTestId('hasMore')).toHaveTextContent('true');
    expect(apiMocks.getMemos).toHaveBeenCalledWith('token', expect.objectContaining({
      category: 'work',
      search: 'q',
      limit: 24,
      offset: 0,
    }));
  });

  it('pages forward and back by offset', async () => {
    renderWithClient(<MemosProbe controls />);
    await waitFor(() => expect(screen.getByTestId('memos')).toHaveTextContent('memo-1:First'));

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('1'));
    await waitFor(() => expect(apiMocks.getMemos).toHaveBeenCalledWith('token', expect.objectContaining({ offset: 24 })));

    fireEvent.click(screen.getByRole('button', { name: 'prev' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('0'));
  });

  it('resets to page 0 when the category filter changes', async () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthContext.Provider value={{ authToken: 'token', user: { email: 'person@example.com' } }}>
          <MemosProbe category="all" />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('memos')).toHaveTextContent('memo-1:First'));

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthContext.Provider value={{ authToken: 'token', user: { email: 'person@example.com' } }}>
          <MemosProbe category="ideas" />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('0'));
  });

  it('refetches the memo list after create, update, and delete mutations', async () => {
    renderWithClient(<MemosProbe controls />);
    await waitFor(() => expect(screen.getByTestId('memos')).toHaveTextContent('memo-1:First'));
    expect(apiMocks.getMemos).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(apiMocks.createMemo).toHaveBeenCalledWith('token', { title: 'Second' }));
    await waitFor(() => expect(apiMocks.getMemos).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'update' }));
    await waitFor(() => expect(apiMocks.updateMemo).toHaveBeenCalledWith('token', { id: 'memo-1', title: 'Updated' }));
    await waitFor(() => expect(apiMocks.getMemos).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(apiMocks.deleteMemo).toHaveBeenCalledWith('token', 'memo-2'));
    await waitFor(() => expect(apiMocks.getMemos).toHaveBeenCalledTimes(4));
  });
});
