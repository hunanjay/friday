import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import { searchMailPage } from './mailboxApi';
import { useMailSearch } from './useMailSearch';

vi.mock('./mailboxApi', async (importOriginal) => ({
  ...(await importOriginal()),
  searchMailPage: vi.fn(),
}));

const CHANNELS = ['microsoft', 'mail-1'];

function SearchProbe({ query }) {
  const {
    canLoadMoreSearch,
    isLoadingMoreSearch,
    isSearching,
    loadMoreSearch,
    searchResults,
  } = useMailSearch({
    activeFolder: 'inbox',
    debounceMs: 0,
    mailChannels: CHANNELS,
    searchQuery: query,
  });
  return (
    <div>
      <span data-testid="results">{searchResults.map(message => message.id).join(',')}</span>
      <span data-testid="status">
        {`${canLoadMoreSearch}:${isLoadingMoreSearch}:${isSearching}`}
      </span>
      <button onClick={loadMoreSearch}>more</button>
    </div>
  );
}

function renderSearch(query = 'report') {
  const auth = {
    authToken: 'token',
    handleLogout: vi.fn(),
    user: { id: 'user-1' },
  };
  const view = render(
    <AuthContext.Provider value={auth}>
      <SearchProbe query={query} />
    </AuthContext.Provider>,
  );
  return { ...view, auth };
}

describe('useMailSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMailPage.mockImplementation(async (_token, { channel, cursor }) => {
      if (cursor === 'next-ms') {
        return {
          value: [{ id: 'graph-1' }, { id: 'graph-2' }],
          next_cursor: null,
        };
      }
      return {
        value: [{
          id: channel === 'microsoft' ? 'graph-1' : `imap:${channel}:INBOX:1`,
          provider: channel === 'microsoft' ? 'graph' : 'imap',
        }],
        next_cursor: channel === 'microsoft' ? 'next-ms' : null,
      };
    });
  });

  it('searches every channel and deduplicates paginated results', async () => {
    renderSearch();

    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent(
      'graph-1,imap:mail-1:INBOX:1',
    ));
    expect(screen.getByTestId('status')).toHaveTextContent('true:false:false');
    expect(searchMailPage).toHaveBeenCalledWith('token', expect.objectContaining({
      channel: 'microsoft',
      folder: 'inbox',
      query: 'report',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent(
      'graph-1,imap:mail-1:INBOX:1,graph-2',
    ));
  });

  it('drops a pagination response after the query changes', async () => {
    let resolvePage;
    const delayedPage = new Promise(resolve => { resolvePage = resolve; });
    searchMailPage.mockImplementation(async (_token, { cursor, query }) => {
      if (cursor) return delayedPage;
      return {
        value: [{ id: query === 'report' ? 'old-result' : 'new-result' }],
        next_cursor: query === 'report' ? 'next-ms' : null,
      };
    });
    const { rerender, auth } = renderSearch('report');
    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('old-result'));
    fireEvent.click(screen.getByRole('button', { name: 'more' }));

    rerender(
      <AuthContext.Provider value={auth}>
        <SearchProbe query="budget" />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('new-result'));
    await act(async () => resolvePage({ value: [{ id: 'stale-page' }], next_cursor: null }));
    expect(screen.getByTestId('results')).not.toHaveTextContent('stale-page');
  });

  it('logs out when search authorization expires', async () => {
    searchMailPage.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    const { auth } = renderSearch();

    await waitFor(() => expect(auth.handleLogout).toHaveBeenCalled());
    expect(screen.getByTestId('results')).toBeEmptyDOMElement();
  });
});
