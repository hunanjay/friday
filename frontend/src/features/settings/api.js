import { apiRequest } from '../../api/client';

export const DEFAULT_ASSISTANT_NAME = 'Friday';

export async function getAssistantName(token) {
  const data = await apiRequest('/api/settings/assistant-name', { token });
  return data?.assistant_name || DEFAULT_ASSISTANT_NAME;
}

export async function updateAssistantName(token, assistantName) {
  const data = await apiRequest('/api/settings/assistant-name', {
    method: 'PUT',
    token,
    body: { assistant_name: assistantName },
  });
  return data?.assistant_name || DEFAULT_ASSISTANT_NAME;
}

export async function getSignatures(token) {
  const data = await apiRequest('/api/settings/signatures', { token });
  return data?.signatures || [];
}

export async function createSignature(token, { name, content }) {
  const data = await apiRequest('/api/settings/signatures', {
    method: 'POST',
    token,
    body: { name, content },
  });
  return data?.signature ?? null;
}

export async function updateSignature(token, id, { name, content }) {
  const data = await apiRequest(`/api/settings/signatures/${id}`, {
    method: 'PUT',
    token,
    body: { name, content },
  });
  return data?.signature ?? null;
}

// Returns the whole list: promoting one template demotes another, so the
// caller would otherwise have to guess which other row changed.
export async function setDefaultSignature(token, id) {
  const data = await apiRequest(`/api/settings/signatures/${id}/default`, {
    method: 'PUT',
    token,
  });
  return data?.signatures || [];
}

export async function deleteSignature(token, id) {
  await apiRequest(`/api/settings/signatures/${id}`, { method: 'DELETE', token });
  return id;
}

export async function getAvatar(token) {
  const data = await apiRequest('/api/settings/avatar', { token });
  return data?.avatar_url ?? null;
}

export async function updateAvatar(token, avatarUrl) {
  const data = await apiRequest('/api/settings/avatar', {
    method: 'PUT',
    token,
    body: { avatar_url: avatarUrl },
  });
  return data?.avatar_url ?? null;
}

export async function getAvatarPresets(token) {
  const data = await apiRequest('/api/settings/avatar-presets', { token });
  return data?.presets || [];
}

export function getTeamInfo(token) {
  return apiRequest('/api/agent/team_info', { token });
}

// Total registered users. 403 for anyone not in the backend's
// ADMIN_USER_IDS allowlist, which is how the UI decides to hide the section.
export async function getUsageStats(token) {
  return apiRequest('/api/stats', { token });
}
