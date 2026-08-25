import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../features/auth/AuthProvider';
import { useAuth } from '../features/auth/useAuth';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  signInWithOAuth: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../api/client', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut,
      signInWithOAuth: mocks.signInWithOAuth,
    },
  },
}));

let authCallback;

function AuthProbe() {
  const { user, authToken, isAuthReady, handleLogout, handleSwitchAccount, handleMsLogout } = useAuth();
  return (
    <div>
      <span data-testid="user">{user?.email || 'none'}</span>
      <span data-testid="token">{authToken || 'none'}</span>
      <span data-testid="ready">{String(isAuthReady)}</span>
      <button type="button" onClick={handleLogout}>logout</button>
      <button type="button" onClick={handleSwitchAccount}>switch</button>
      <button type="button" onClick={handleMsLogout}>ms-logout</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  authCallback = null;
  mocks.apiRequest.mockReset().mockResolvedValue({ status: 'ok' });
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.signInWithOAuth.mockReset().mockResolvedValue({ error: null });
  mocks.unsubscribe.mockReset();
  mocks.onAuthStateChange.mockReset().mockImplementation(callback => {
    authCallback = callback;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('hydrates the cached user while waiting for Supabase', () => {
    localStorage.setItem('user', JSON.stringify({ email: 'cached@example.com', name: 'Cached' }));
    render(<AuthProvider><AuthProbe /></AuthProvider>);

    expect(screen.getByTestId('user')).toHaveTextContent('cached@example.com');
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  it('publishes a session after persisting a fresh provider token', async () => {
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    const session = {
      access_token: 'supabase-token',
      provider_token: 'graph-token',
      provider_refresh_token: 'graph-refresh',
      user: {
        email: 'logan@example.com',
        user_metadata: { full_name: 'Logan', avatar_url: '/avatar.png' },
      },
    };

    act(() => authCallback('SIGNED_IN', session));

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/graph/token', {
      method: 'POST',
      token: 'supabase-token',
      body: { ms_token: 'graph-token', refresh_token: 'graph-refresh' },
    });
    expect(screen.getByTestId('token')).toHaveTextContent('supabase-token');
    expect(screen.getByTestId('user')).toHaveTextContent('logan@example.com');
    expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({ name: 'Logan' });
  });

  it('clears private workspace data immediately on logout', async () => {
    localStorage.setItem('user', '{}');
    localStorage.setItem('emails', '[{"id":"mail"}]');
    localStorage.setItem('events', '[{"id":"event"}]');
    localStorage.setItem('sidebar_collapsed', 'true');
    render(<AuthProvider><AuthProbe /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('emails')).toBeNull();
    expect(localStorage.getItem('events')).toBeNull();
    expect(localStorage.getItem('sidebar_collapsed')).toBe('true');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('clears stale auth state when Supabase reports no session', async () => {
    localStorage.setItem('user', JSON.stringify({ email: 'old@example.com' }));
    const { unmount } = render(<AuthProvider><AuthProbe /></AuthProvider>);

    act(() => authCallback('SIGNED_OUT', null));

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not revive an old session after a concurrent sign-out', async () => {
    let finishTokenHandoff;
    mocks.apiRequest.mockReturnValue(new Promise(resolve => {
      finishTokenHandoff = resolve;
    }));
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    const session = {
      access_token: 'stale-token',
      provider_token: 'graph-token',
      user: { email: 'logan@example.com', user_metadata: {} },
    };

    act(() => authCallback('SIGNED_IN', session));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledOnce());
    act(() => authCallback('SIGNED_OUT', null));
    act(() => finishTokenHandoff({ status: 'ok' }));

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('switching accounts signs out locally then reopens Microsoft with an account picker', async () => {
    localStorage.setItem('user', '{}');
    render(<AuthProvider><AuthProbe /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'switch' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.signInWithOAuth).toHaveBeenCalledOnce();
    const [[call]] = mocks.signInWithOAuth.mock.calls;
    expect(call.provider).toBe('azure');
    expect(call.options.queryParams).toEqual({ prompt: 'select_account' });
    // Only this app's session is cleared - the backend never hears about it,
    // since the previous Microsoft account's Graph token is still valid.
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('a real Microsoft sign-out revokes the stored Graph token before ending the browser SSO session', async () => {
    localStorage.setItem('user', '{}');
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    const session = {
      access_token: 'supabase-token',
      user: { email: 'logan@example.com', user_metadata: {} },
    };
    act(() => authCallback('SIGNED_IN', session));
    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('supabase-token'));
    delete window.location;
    window.location = { origin: 'http://localhost:3000', href: '' };

    fireEvent.click(screen.getByRole('button', { name: 'ms-logout' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/graph/token', {
      method: 'DELETE',
      token: 'supabase-token',
    });
    expect(window.location.href).toContain('login.microsoftonline.com');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
});
