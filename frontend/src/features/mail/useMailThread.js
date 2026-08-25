import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import {
  getMailMessage,
  getMailThread,
  getMailThreadResource,
  markMailMessageRead,
  normalizeMailMessage,
} from './mailboxApi';
import { useInboxUnread, useMailMessages } from './mailboxHooks';

const THREAD_PREFETCH_DELAY_MS = 300;
const THREAD_CACHE_MAX_ENTRIES = 10;

function conversationKey(threadRow) {
  return threadRow._threadKey || threadRow.conversationId || threadRow.id;
}

export function useMailThread({ onOpen }) {
  const { authToken, handleLogout, user } = useAuth();
  const { emails, markEmailRead } = useMailMessages();
  const { adjustInboxUnread } = useInboxUnread();
  const [selectedConversationKey, setSelectedConversationKey] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [expandedMessageIds, setExpandedMessageIds] = useState(new Set());
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const cacheRef = useRef(new Map());
  const requestsRef = useRef(new Map());
  const prefetchTimersRef = useRef(new Map());
  const selectionSequenceRef = useRef(0);
  const linkedRequestKeyRef = useRef(null);
  const scope = user?.id || user?.email || 'anonymous';
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => () => {
    prefetchTimersRef.current.forEach(timer => window.clearTimeout(timer));
    prefetchTimersRef.current.clear();
  }, []);

  useEffect(() => {
    selectionSequenceRef.current += 1;
    prefetchTimersRef.current.forEach(timer => window.clearTimeout(timer));
    prefetchTimersRef.current.clear();
    cacheRef.current.clear();
    requestsRef.current.clear();
    linkedRequestKeyRef.current = null;
    setSelectedConversationKey(null);
    setThreadMessages([]);
    setExpandedMessageIds(new Set());
    setIsLoadingThread(false);
  }, [scope]);

  const handleUnauthorized = useCallback((error) => {
    if (!isApiError(error) || error.status !== 401) return false;
    void handleLogout();
    return true;
  }, [handleLogout]);

  const cachedThread = useCallback((key) => {
    if (!cacheRef.current.has(key)) return undefined;
    const cached = cacheRef.current.get(key);
    cacheRef.current.delete(key);
    cacheRef.current.set(key, cached);
    return cached;
  }, []);

  const loadThread = useCallback((threadRow) => {
    const { key } = getMailThreadResource(threadRow);
    const cached = cachedThread(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const existingRequest = requestsRef.current.get(key);
    if (existingRequest) return existingRequest;

    const requestScope = scope;
    const request = getMailThread(authToken, threadRow)
      .then(messages => {
        if (requestsRef.current.get(key) === request) requestsRef.current.delete(key);
        if (scopeRef.current !== requestScope) return messages;
        if (cacheRef.current.size >= THREAD_CACHE_MAX_ENTRIES) {
          cacheRef.current.delete(cacheRef.current.keys().next().value);
        }
        cacheRef.current.set(key, messages);
        return messages;
      })
      .catch(error => {
        if (requestsRef.current.get(key) === request) requestsRef.current.delete(key);
        handleUnauthorized(error);
        throw error;
      });
    requestsRef.current.set(key, request);
    return request;
  }, [authToken, cachedThread, handleUnauthorized, scope]);

  const cancelThreadPrefetch = useCallback((threadRow) => {
    const { key } = getMailThreadResource(threadRow);
    const timer = prefetchTimersRef.current.get(key);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    prefetchTimersRef.current.delete(key);
  }, []);

  const prefetchThread = useCallback((threadRow) => {
    const { key } = getMailThreadResource(threadRow);
    if (
      conversationKey(threadRow) === selectedConversationKey
      || cacheRef.current.has(key)
      || requestsRef.current.has(key)
      || prefetchTimersRef.current.has(key)
    ) return;

    prefetchTimersRef.current.forEach((timer, pendingKey) => {
      if (pendingKey !== key) window.clearTimeout(timer);
    });
    prefetchTimersRef.current.clear();
    const timer = window.setTimeout(() => {
      prefetchTimersRef.current.delete(key);
      loadThread(threadRow).catch(() => {});
    }, THREAD_PREFETCH_DELAY_MS);
    prefetchTimersRef.current.set(key, timer);
  }, [loadThread, selectedConversationKey]);

  const selectThread = useCallback((threadRow) => {
    const nextConversationKey = conversationKey(threadRow);
    if (nextConversationKey === selectedConversationKey) return;
    const selectionSequence = ++selectionSequenceRef.current;
    cancelThreadPrefetch(threadRow);

    const unreadInboxIds = emails
      .filter(email => (
        !email.isRead
        && email.parentFolderId === 'inbox'
        && (email.conversationId || email.id) === nextConversationKey
      ))
      .map(email => email.id);
    if (
      unreadInboxIds.length === 0
      && !threadRow.isRead
      && threadRow.parentFolderId === 'inbox'
    ) {
      unreadInboxIds.push(threadRow.id);
    }

    const readIds = new Set(unreadInboxIds);
    unreadInboxIds.forEach(messageId => {
      markEmailRead(messageId, true);
      adjustInboxUnread(-1);
      markMailMessageRead(authToken, messageId).catch(handleUnauthorized);
    });

    setSelectedConversationKey(nextConversationKey);
    setThreadMessages([]);
    setExpandedMessageIds(new Set());
    onOpen?.();

    const { key } = getMailThreadResource(threadRow);
    const cached = cachedThread(key);
    const localReadState = new Map(emails.map(email => [email.id, email.isRead]));
    const applyThread = (messages) => {
      if (selectionSequence !== selectionSequenceRef.current) return;
      const unreadBeforeOpen = messages
        .filter(message => localReadState.has(message.id)
          ? !localReadState.get(message.id)
          : !message.isRead)
        .map(message => message.id);
      setThreadMessages(messages.map(message => ({
        ...message,
        isRead: readIds.has(message.id)
          ? true
          : (localReadState.has(message.id) ? localReadState.get(message.id) : message.isRead),
      })));
      setExpandedMessageIds(
        unreadBeforeOpen.length > 0
          ? new Set(unreadBeforeOpen)
          : messages.length > 0 ? new Set([messages[messages.length - 1].id]) : new Set(),
      );
    };

    if (cached !== undefined) {
      applyThread(cached);
      setIsLoadingThread(false);
      return;
    }

    setIsLoadingThread(true);
    loadThread(threadRow)
      .then(applyThread)
      .catch(() => {})
      .finally(() => {
        if (selectionSequence === selectionSequenceRef.current) setIsLoadingThread(false);
      });
  }, [
    adjustInboxUnread,
    authToken,
    cachedThread,
    cancelThreadPrefetch,
    emails,
    handleUnauthorized,
    loadThread,
    markEmailRead,
    onOpen,
    selectedConversationKey,
  ]);

  const removeThreadMessage = useCallback((messageId) => {
    cacheRef.current.forEach((messages, key) => {
      cacheRef.current.set(key, messages.filter(message => message.id !== messageId));
    });
    setThreadMessages(previous => {
      const next = previous.filter(message => message.id !== messageId);
      if (next.length === 0) setSelectedConversationKey(null);
      return next;
    });
  }, []);

  const clearThreadSelection = useCallback(() => {
    selectionSequenceRef.current += 1;
    setSelectedConversationKey(null);
    setIsLoadingThread(false);
  }, []);

  const toggleMessageExpanded = useCallback((messageId) => {
    setExpandedMessageIds(previous => {
      const next = new Set(previous);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const loadLinkedMessage = useCallback(async ({ messageId, folder, provider }) => {
    const requestKey = `${provider}:${messageId}`;
    if (linkedRequestKeyRef.current === requestKey) return null;
    linkedRequestKeyRef.current = requestKey;
    try {
      const message = await getMailMessage(authToken, messageId);
      return normalizeMailMessage(message, folder);
    } catch (error) {
      handleUnauthorized(error);
      throw error;
    } finally {
      linkedRequestKeyRef.current = null;
    }
  }, [authToken, handleUnauthorized]);

  return {
    cancelThreadPrefetch,
    clearThreadSelection,
    expandedMessageIds,
    isLoadingThread,
    loadLinkedMessage,
    prefetchThread,
    removeThreadMessage,
    selectThread,
    selectedConversationKey,
    threadMessages,
    toggleMessageExpanded,
  };
}
