import { useCallback, useState } from 'react';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import { decideChatAction } from './api';
import {
  mergeLiveApprovals,
  replaceDecisionApprovals,
  restorePersistedApprovals,
} from './approvalState';

export function useChatApprovals({
  sessionId,
  failureMessage,
  onPreview,
  onUnauthorized,
}) {
  const { authToken, handleLogout } = useAuth();
  const [pendingActions, setPendingActions] = useState([]);

  const clearApprovals = useCallback(() => setPendingActions([]), []);

  const restoreApprovals = useCallback((actions, messages) => {
    setPendingActions(restorePersistedApprovals(actions, messages));
  }, []);

  const applyLiveApprovals = useCallback((actions, optimisticBotMessageId) => {
    setPendingActions(previous => mergeLiveApprovals(
      previous,
      actions,
      optimisticBotMessageId,
    ));
  }, []);

  const decideApproval = useCallback(async (action, decision, edits) => {
    setPendingActions(previous => previous.map(item => (
      item.id === action.id ? { ...item, busy: true, error: '' } : item
    )));
    const actionSessionId = action.session_id || sessionId;
    try {
      const data = await decideChatAction(authToken, {
        actionId: action.id,
        decision,
        sessionId: actionSessionId,
        edits,
      });
      const selectedDecision = action.decisions?.find(item => item.id === decision);
      if (Array.isArray(data.pending_actions)) {
        setPendingActions(previous => replaceDecisionApprovals(previous, data.pending_actions));
      } else if ((selectedDecision?.outcome || decision) === 'approve') {
        setPendingActions(previous => previous.map(item => (
          item.id === action.id
            ? { ...item, busy: false, resolved: true, status: 'succeeded' }
            : item
        )));
      } else {
        setPendingActions(previous => previous.filter(item => item.id !== action.id));
      }
      if (data.preview) onPreview?.(actionSessionId, data.preview);
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        void handleLogout();
        onUnauthorized?.();
        return;
      }
      if (isApiError(error) && error.status === 410) {
        setPendingActions(previous => previous.map(item => (
          item.id === action.id
            ? { ...item, busy: false, resolved: true, status: 'expired', error: '' }
            : item
        )));
        return;
      }
      setPendingActions(previous => previous.map(item => (
        item.id === action.id
          ? { ...item, busy: false, error: error.message || failureMessage }
          : item
      )));
    }
  }, [authToken, failureMessage, handleLogout, onPreview, onUnauthorized, sessionId]);

  return {
    pendingActions,
    applyLiveApprovals,
    clearApprovals,
    decideApproval,
    restoreApprovals,
  };
}
