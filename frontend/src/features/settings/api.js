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

export async function getSignature(token) {
  const data = await apiRequest('/api/settings/signature', { token });
  return data?.signature || '';
}

export async function updateSignature(token, signature) {
  const data = await apiRequest('/api/settings/signature', {
    method: 'PUT',
    token,
    body: { signature },
  });
  return data?.signature || '';
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
