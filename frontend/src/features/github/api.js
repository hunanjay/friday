import { apiRequest } from '../../api/client';

export const EMPTY_GITHUB_REPOSITORIES = Object.freeze({
  available: [],
  selected: [],
});

export async function getGitHubStatus(token) {
  return apiRequest('/api/github/status', { token });
}

export async function getGitHubRepositories(token) {
  const data = await apiRequest('/api/github/repos', { token });
  return {
    available: data?.repos || [],
    selected: data?.selected || [],
  };
}

export async function updateGitHubRepositories(token, repositories) {
  const data = await apiRequest('/api/github/repos', {
    method: 'PUT',
    token,
    body: { repos: repositories },
  });
  return data?.repos || [];
}

export async function disconnectGitHub(token) {
  await apiRequest('/api/github/token', {
    method: 'DELETE',
    token,
  });
}

export async function getGitHubCommits(token, { since, until }) {
  const data = await apiRequest('/api/github/commits', {
    token,
    query: { since, until },
  });
  return data?.commits || [];
}

export function githubConnectUrl(token) {
  const apiUrl = import.meta.env.VITE_API_URL || '';
  return `${apiUrl}/api/github/connect?token=${encodeURIComponent(token)}`;
}
