import { apiRequest } from '../../api/client';

export async function getChatSessions(token) {
  const data = await apiRequest('/api/agent/sessions', { token });
  return data?.sessions || [];
}

export function createChatSession(token, title) {
  return apiRequest('/api/agent/sessions', {
    method: 'POST',
    token,
    body: { title },
  });
}

export async function deleteChatSession(token, sessionId) {
  await apiRequest(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    token,
  });
  return sessionId;
}

export function getChatSessionMessages(token, sessionId) {
  return apiRequest(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { token });
}

export function getPendingChatActions(token, sessionId) {
  return apiRequest('/api/agent/actions', {
    token,
    query: { session_id: sessionId },
  });
}

export function decideChatAction(token, { actionId, decision, sessionId, edits }) {
  return apiRequest(
    `/api/agent/actions/${encodeURIComponent(actionId)}/decisions/${encodeURIComponent(decision)}`,
    {
      method: 'POST',
      token,
      query: { session_id: sessionId },
      body: { payload: edits && Object.keys(edits).length ? edits : null },
    },
  );
}
