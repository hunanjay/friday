import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import { normalizeMailMessage, searchMailPage } from './mailboxApi';

const EMPTY_PAGE = { value: [], next_cursor: null };
const SEARCH_FOLDERS = { inbox: 'inbox', sent: 'sent', trash: 'deleted' };

function cursorMap(channels, pages) {
  return Object.fromEntries(
    channels.map((channel, index) => [channel, pages[index]?.next_cursor || null]),
  );
}

function normalizedResults(pages, folder) {
  return pages.flatMap(page => (
    page?.value || []
  ).map(message => normalizeMailMessage(message, folder)));
}

export function useMailSearch({ activeFolder, debounceMs = 350, mailChannels, searchQuery }) {
  const { authToken, handleLogout, user } = useAuth();
  const tokenRef = useRef(authToken);
  const queryRef = useRef(searchQuery);
  const [searchResults, setSearchResults] = useState([]);
  const [searchCursor, setSearchCursor] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMoreSearch, setIsLoadingMoreSearch] = useState(false);
  const scope = user?.id || user?.email || 'anonymous';
  const hasAuthToken = Boolean(authToken);
  const normalizedQuery = searchQuery.trim();
  const searchFolder = SEARCH_FOLDERS[activeFolder] || 'inbox';

  useEffect(() => {
    tokenRef.current = authToken;
    queryRef.current = searchQuery;
  }, [authToken, searchQuery]);

  const fetchSearchPage = useCallback(async (channel, options) => {
    try {
      return await searchMailPage(tokenRef.current, { channel, ...options });
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        void handleLogout();
        return null;
      }
      if (isApiError(error)) return EMPTY_PAGE;
      throw error;
    }
  }, [handleLogout]);

  useEffect(() => {
    if (!hasAuthToken || !normalizedQuery) {
      setSearchResults([]);
      setSearchCursor(null);
      setIsSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    let ignore = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      Promise.all(mailChannels.map(channel => fetchSearchPage(channel, {
        folder: searchFolder,
        query: normalizedQuery,
        signal: controller.signal,
      })))
        .then(pages => {
          if (ignore || !pages.some(Boolean)) return;
          setSearchResults(normalizedResults(pages, activeFolder));
          setSearchCursor(cursorMap(mailChannels, pages));
        })
        .catch(() => {})
        .finally(() => {
          if (!ignore) setIsSearching(false);
        });
    }, debounceMs);

    return () => {
      ignore = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeFolder,
    debounceMs,
    fetchSearchPage,
    hasAuthToken,
    mailChannels,
    normalizedQuery,
    scope,
    searchFolder,
  ]);

  const loadMoreSearch = useCallback(async () => {
    const activeChannels = mailChannels.filter(channel => searchCursor?.[channel]);
    if (activeChannels.length === 0 || isLoadingMoreSearch) return;
    const requestedQuery = searchQuery;
    setIsLoadingMoreSearch(true);
    try {
      const pages = await Promise.all(activeChannels.map(channel => fetchSearchPage(channel, {
        cursor: searchCursor[channel],
      })));
      if (requestedQuery !== queryRef.current || !pages.some(Boolean)) return;
      setSearchResults(previous => {
        const seen = new Set(previous.map(message => message.id));
        const next = normalizedResults(pages, activeFolder).filter(message => !seen.has(message.id));
        return [...previous, ...next];
      });
      setSearchCursor(cursorMap(activeChannels, pages));
    } catch {
      // Search is non-destructive; retain the current results on transient failure.
    } finally {
      setIsLoadingMoreSearch(false);
    }
  }, [
    activeFolder,
    fetchSearchPage,
    isLoadingMoreSearch,
    mailChannels,
    searchCursor,
    searchQuery,
  ]);

  return {
    canLoadMoreSearch: mailChannels.some(channel => Boolean(searchCursor?.[channel])),
    isLoadingMoreSearch,
    isSearching,
    loadMoreSearch,
    searchResults,
  };
}
