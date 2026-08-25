import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  disconnectGitHub,
  getGitHubCommits,
  getGitHubRepositories,
  getGitHubStatus,
  githubConnectUrl,
  updateGitHubRepositories,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('GitHub API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads connection status through the shared client', async () => {
    const status = { connected: true, login: 'octocat' };
    apiRequest.mockResolvedValueOnce(status);

    await expect(getGitHubStatus('token')).resolves.toBe(status);
    expect(apiRequest).toHaveBeenCalledWith('/api/github/status', { token: 'token' });
  });

  it('normalizes available and selected repositories', async () => {
    apiRequest.mockResolvedValueOnce({
      repos: [{ full_name: 'openai/codex', private: false }],
      selected: ['openai/codex'],
    });

    await expect(getGitHubRepositories('token')).resolves.toEqual({
      available: [{ full_name: 'openai/codex', private: false }],
      selected: ['openai/codex'],
    });
  });

  it('updates the repository selection', async () => {
    apiRequest.mockResolvedValueOnce({ repos: ['openai/codex'] });

    await expect(updateGitHubRepositories('token', ['openai/codex'])).resolves.toEqual(['openai/codex']);
    expect(apiRequest).toHaveBeenCalledWith('/api/github/repos', {
      method: 'PUT',
      token: 'token',
      body: { repos: ['openai/codex'] },
    });
  });

  it('disconnects through the shared client', async () => {
    apiRequest.mockResolvedValueOnce({ status: 'ok' });

    await disconnectGitHub('token');
    expect(apiRequest).toHaveBeenCalledWith('/api/github/token', {
      method: 'DELETE',
      token: 'token',
    });
  });

  it('loads a commit window with encoded query parameters through the client', async () => {
    apiRequest.mockResolvedValueOnce({ commits: [{ sha: 'abc123' }] });

    await expect(getGitHubCommits('token', {
      since: '2026-08-24T00:00:00Z',
      until: '2026-08-30T23:59:59Z',
    })).resolves.toEqual([{ sha: 'abc123' }]);
    expect(apiRequest).toHaveBeenCalledWith('/api/github/commits', {
      token: 'token',
      query: {
        since: '2026-08-24T00:00:00Z',
        until: '2026-08-30T23:59:59Z',
      },
    });
  });

  it('encodes the session token in the OAuth entry URL', () => {
    expect(githubConnectUrl('token with/+')).toBe('/api/github/connect?token=token%20with%2F%2B');
  });
});
