import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useGitHubCommits, useGitHubConnection, useGitHubRepositories } from './hooks';

const apiMocks = vi.hoisted(() => ({
  disconnectGitHub: vi.fn(),
  getGitHubCommits: vi.fn(),
  getGitHubRepositories: vi.fn(),
  getGitHubStatus: vi.fn(),
  updateGitHubRepositories: vi.fn(),
}));

vi.mock('./api', () => ({
  EMPTY_GITHUB_REPOSITORIES: { available: [], selected: [] },
  disconnectGitHub: apiMocks.disconnectGitHub,
  getGitHubCommits: apiMocks.getGitHubCommits,
  getGitHubRepositories: apiMocks.getGitHubRepositories,
  getGitHubStatus: apiMocks.getGitHubStatus,
  githubConnectUrl: vi.fn(() => '/api/github/connect'),
  updateGitHubRepositories: apiMocks.updateGitHubRepositories,
}));

function GitHubProbe({ id, controls = false }) {
  const { githubStatus, disconnectGitHub } = useGitHubConnection();
  const { githubRepositories, saveGitHubRepositories } = useGitHubRepositories({
    enabled: Boolean(githubStatus?.connected),
  });
  return (
    <div>
      <span data-testid={`${id}-status`}>{githubStatus?.connected ? 'connected' : 'disconnected'}</span>
      <span data-testid={`${id}-repos`}>{githubRepositories.selected.join(',')}</span>
      {controls && (
        <>
          <button onClick={() => saveGitHubRepositories(['openai/codex'])}>save</button>
          <button onClick={() => disconnectGitHub()}>disconnect</button>
        </>
      )}
    </div>
  );
}

function CommitsProbe() {
  const { commits, commitsError } = useGitHubCommits({
    since: '2026-08-24T00:00:00Z',
    until: '2026-08-30T23:59:59Z',
  });
  return <span data-testid="commits">{`${commitsError}:${commits.map(commit => commit.sha).join(',')}`}</span>;
}

describe('GitHub hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getGitHubStatus.mockResolvedValue({ connected: true, login: 'octocat' });
    apiMocks.getGitHubRepositories.mockResolvedValue({ available: [], selected: ['before/repo'] });
    apiMocks.updateGitHubRepositories.mockResolvedValue(['openai/codex']);
    apiMocks.disconnectGitHub.mockResolvedValue(undefined);
    apiMocks.getGitHubCommits.mockResolvedValue([{ sha: 'abc123' }]);
  });

  it('deduplicates consumers and synchronizes save and disconnect mutations', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', user: { email: 'person@example.com' } };

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <GitHubProbe id="first" controls />
          <GitHubProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('first-repos')).toHaveTextContent('before/repo'));
    expect(apiMocks.getGitHubStatus).toHaveBeenCalledTimes(1);
    expect(apiMocks.getGitHubRepositories).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(screen.getByTestId('second-repos')).toHaveTextContent('openai/codex'));
    expect(apiMocks.updateGitHubRepositories).toHaveBeenCalledWith('token', ['openai/codex']);

    fireEvent.click(screen.getByRole('button', { name: 'disconnect' }));
    await waitFor(() => expect(screen.getByTestId('second-status')).toHaveTextContent('disconnected'));
    expect(screen.getByTestId('first-repos')).toBeEmptyDOMElement();
    expect(apiMocks.disconnectGitHub).toHaveBeenCalledWith('token');
  });

  it('loads a dashboard commit window through an independently keyed query', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', handleLogout: vi.fn(), user: { id: 'user-1' } };
    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <CommitsProbe />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('commits')).toHaveTextContent('false:abc123'));
    expect(apiMocks.getGitHubCommits).toHaveBeenCalledWith('token', {
      since: '2026-08-24T00:00:00Z',
      until: '2026-08-30T23:59:59Z',
    });
  });
});
