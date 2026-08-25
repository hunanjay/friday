import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import { useMailAccounts } from './accountHooks';
import { getMailFolderPage, MICROSOFT_MAIL_CHANNEL, normalizeMailMessage } from './mailboxApi';
import { useMailMessages, useMailSyncStatus } from './mailboxHooks';

const EMPTY_PAGE = { value: [], next_cursor: null };

function cursorMap(channels, pages) {
  return Object.fromEntries(
    channels.map((channel, index) => [channel, pages[index]?.next_cursor || null]),
  );
}

function normalizePages(pages, folder) {
  return pages.flatMap(page => (
    page?.value || []
  ).map(message => normalizeMailMessage(message, folder)));
}

export function useMailFolderSync({ activeFolder, onError }) {
  const { authToken, handleLogout, user } = useAuth();
  const { mailAccounts } = useMailAccounts();
  const {
    appendEmails,
    syncInboxEmails,
    syncSentEmails,
  } = useMailMessages();
  const { setIsSyncingInbox } = useMailSyncStatus();
  const tokenRef = useRef(authToken);
  const [inboxCursor, setInboxCursor] = useState(null);
  const [sentCursor, setSentCursor] = useState(null);
  const [hasFetchedSent, setHasFetchedSent] = useState(false);
  const [isLoadingMoreInbox, setIsLoadingMoreInbox] = useState(false);
  const [isLoadingMoreSent, setIsLoadingMoreSent] = useState(false);
  const [isSyncingSent, setIsSyncingSent] = useState(false);
  const scope = user?.id || user?.email || 'anonymous';
  const hasAuthToken = Boolean(authToken);
  const mailChannels = useMemo(
    () => [MICROSOFT_MAIL_CHANNEL, ...mailAccounts.map(account => account.id)],
    [mailAccounts],
  );

  useEffect(() => {
    tokenRef.current = authToken;
  }, [authToken]);

  useEffect(() => {
    setInboxCursor(null);
    setSentCursor(null);
    setHasFetchedSent(false);
  }, [scope]);

  const fetchChannelPage = useCallback(async (channel, folder, cursor) => {
    try {
      return await getMailFolderPage(tokenRef.current, { channel, folder, cursor });
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        void handleLogout();
        return null;
      }
      if (isApiError(error)) return EMPTY_PAGE;
      throw error;
    }
  }, [handleLogout]);

  const syncInbox = useCallback(async () => {
    if (!hasAuthToken) return;
    setIsSyncingInbox(true);
    try {
      const pages = await Promise.all(
        mailChannels.map(channel => fetchChannelPage(channel, 'inbox')),
      );
      if (!pages.some(Boolean)) return;
      syncInboxEmails(normalizePages(pages, 'inbox'));
      setInboxCursor(cursorMap(mailChannels, pages));
    } catch {
      onError?.();
    } finally {
      setIsSyncingInbox(false);
    }
  }, [
    fetchChannelPage,
    hasAuthToken,
    mailChannels,
    onError,
    setIsSyncingInbox,
    syncInboxEmails,
  ]);

  useEffect(() => {
    if (hasAuthToken) void syncInbox();
  }, [hasAuthToken, scope, syncInbox]);

  const syncSent = useCallback(async () => {
    if (!hasAuthToken) return;
    setIsSyncingSent(true);
    try {
      const pages = await Promise.all(
        mailChannels.map(channel => fetchChannelPage(channel, 'sent')),
      );
      if (!pages.some(Boolean)) return;
      syncSentEmails(normalizePages(pages, 'sent'));
      setSentCursor(cursorMap(mailChannels, pages));
      setHasFetchedSent(true);
    } catch {
      onError?.();
    } finally {
      setIsSyncingSent(false);
    }
  }, [
    fetchChannelPage,
    hasAuthToken,
    mailChannels,
    onError,
    syncSentEmails,
  ]);

  useEffect(() => {
    if (!hasAuthToken || activeFolder !== 'sent' || hasFetchedSent) return;
    void syncSent();
  }, [
    activeFolder,
    hasAuthToken,
    hasFetchedSent,
    syncSent,
  ]);

  const loadMoreFolder = useCallback(async () => {
    const folder = activeFolder === 'sent' ? 'sent' : 'inbox';
    const cursor = folder === 'sent' ? sentCursor : inboxCursor;
    const activeChannels = mailChannels.filter(channel => cursor?.[channel]);
    const isLoading = folder === 'sent' ? isLoadingMoreSent : isLoadingMoreInbox;
    if (activeChannels.length === 0 || isLoading) return;

    const setIsLoading = folder === 'sent' ? setIsLoadingMoreSent : setIsLoadingMoreInbox;
    const setCursor = folder === 'sent' ? setSentCursor : setInboxCursor;
    setIsLoading(true);
    try {
      const pages = await Promise.all(activeChannels.map(channel => (
        fetchChannelPage(channel, folder, cursor[channel])
      )));
      if (!pages.some(Boolean)) return;
      appendEmails(normalizePages(pages, folder));
      setCursor(cursorMap(activeChannels, pages));
    } catch {
      onError?.();
    } finally {
      setIsLoading(false);
    }
  }, [
    activeFolder,
    appendEmails,
    fetchChannelPage,
    inboxCursor,
    isLoadingMoreInbox,
    isLoadingMoreSent,
    mailChannels,
    onError,
    sentCursor,
  ]);

  const activeCursor = activeFolder === 'sent' ? sentCursor : inboxCursor;
  const canLoadMoreFolder = (activeFolder === 'inbox' || activeFolder === 'sent')
    && mailChannels.some(channel => Boolean(activeCursor?.[channel]));

  return {
    canLoadMoreFolder,
    isLoadingMoreFolder: activeFolder === 'sent' ? isLoadingMoreSent : isLoadingMoreInbox,
    isSyncingSent,
    loadMoreFolder,
    mailChannels,
    syncInbox,
    syncSent,
  };
}
