import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  createChatSession,
  decideChatAction,
  deleteChatSession,
  getChatSessionMessages,
  getChatSessions,
  getPendingChatActions,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('chat API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and creates sessions through the shared client', async () => {
    apiRequest
      .mockResolvedValueOnce({ sessions: [{ id: 'session-1' }] })
      .mockResolvedValueOnce({ id: 'session-2', title: 'Second' });

    await expect(getChatSessions('token')).resolves.toEqual([{ id: 'session-1' }]);
    await expect(createChatSession('token', 'Second')).resolves.toEqual({
      id: 'session-2',
      title: 'Second',
    });
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/agent/sessions', { token: 'token' });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/agent/sessions', {
      method: 'POST',
      token: 'token',
      body: { title: 'Second' },
    });
  });

  it('encodes session ids in history and delete paths', async () => {
    apiRequest.mockResolvedValue({ messages: [] });

    await getChatSessionMessages('token', 'session/1');
    await expect(deleteChatSession('token', 'session/1')).resolves.toBe('session/1');
    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/agent/sessions/session%2F1/messages',
      { token: 'token' },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/agent/sessions/session%2F1', {
      method: 'DELETE',
      token: 'token',
    });
  });

  it('keeps approval identifiers and edits out of the URL', async () => {
    apiRequest.mockResolvedValue({ pending_actions: [] });

    await getPendingChatActions('token', 'session-1');
    await decideChatAction('token', {
      actionId: 'action/1',
      decision: 'approve edited',
      sessionId: 'session-1',
      edits: { subject: 'Updated' },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/agent/actions', {
      token: 'token',
      query: { session_id: 'session-1' },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/agent/actions/action%2F1/decisions/approve%20edited',
      {
        method: 'POST',
        token: 'token',
        query: { session_id: 'session-1' },
        body: { payload: { subject: 'Updated' } },
      },
    );
  });
});
