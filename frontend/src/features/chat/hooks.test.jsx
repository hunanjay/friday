import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useChatSessions } from './hooks';

const apiMocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  getChatSessions: vi.fn(),
}));

vi.mock('./api', () => ({
  createChatSession: apiMocks.createChatSession,
  deleteChatSession: apiMocks.deleteChatSession,
  getChatSessions: apiMocks.getChatSessions,
}));

function SessionsProbe({ id, controls = false }) {
  const {
    chatSessions,
    createChatSession,
    deleteChatSession,
    updateChatSessionPreview,
    updateChatSessionTitle,
  } = useChatSessions();
  return (
    <div>
      <span data-testid={id}>
        {chatSessions.map(session => `${session.id}:${session.title}:${session.preview || ''}`).join(',')}
      </span>
      {controls && (
        <>
          <button onClick={() => createChatSession('Second')}>create</button>
          <button onClick={() => updateChatSessionTitle('session-1', 'Renamed')}>rename</button>
          <button onClick={() => updateChatSessionPreview('session-1', 'Preview')}>preview</button>
          <button onClick={() => deleteChatSession('session-2')}>delete</button>
        </>
      )}
    </div>
  );
}

describe('chat session hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getChatSessions.mockResolvedValue([{ id: 'session-1', title: 'First' }]);
    apiMocks.createChatSession.mockResolvedValue({ id: 'session-2', title: 'Second' });
    apiMocks.deleteChatSession.mockResolvedValue('session-2');
  });

  it('deduplicates loading and synchronizes session mutations across consumers', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = {
      authToken: 'token',
      handleLogout: vi.fn(),
      user: { email: 'person@example.com' },
    };

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <SessionsProbe id="first" controls />
          <SessionsProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('session-1:First'));
    expect(apiMocks.getChatSessions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('session-2:Second'));

    fireEvent.click(screen.getByRole('button', { name: 'rename' }));
    fireEvent.click(screen.getByRole('button', { name: 'preview' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('session-1:Renamed:Preview'));

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(screen.getByTestId('first')).not.toHaveTextContent('session-2'));
    expect(apiMocks.createChatSession).toHaveBeenCalledWith('token', 'Second');
    expect(apiMocks.deleteChatSession).toHaveBeenCalledWith('token', 'session-2');
  });

  it('isolates session caches by authenticated user', async () => {
    apiMocks.getChatSessions.mockImplementation(async token => [{
      id: token,
      title: token,
    }]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={{ authToken: 'token-a', user: { id: 'user-a' } }}>
          <SessionsProbe id="user-a" />
        </AuthContext.Provider>
        <AuthContext.Provider value={{ authToken: 'token-b', user: { id: 'user-b' } }}>
          <SessionsProbe id="user-b" />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user-a')).toHaveTextContent('token-a:token-a'));
    await waitFor(() => expect(screen.getByTestId('user-b')).toHaveTextContent('token-b:token-b'));
    expect(apiMocks.getChatSessions).toHaveBeenCalledTimes(2);
  });
});
