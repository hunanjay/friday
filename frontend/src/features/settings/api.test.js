import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  getAssistantName,
  getAvatar,
  getAvatarPresets,
  getSignature,
  updateAssistantName,
  updateAvatar,
  updateSignature,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('settings API', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['assistant name', getAssistantName, '/api/settings/assistant-name', { assistant_name: 'Atlas' }, 'Atlas'],
    ['signature', getSignature, '/api/settings/signature', { signature: 'Regards' }, 'Regards'],
    ['avatar', getAvatar, '/api/settings/avatar', { avatar_url: '/avatars/2.png' }, '/avatars/2.png'],
    ['avatar presets', getAvatarPresets, '/api/settings/avatar-presets', { presets: [{ id: '2' }] }, [{ id: '2' }]],
  ])('loads %s through the shared client', async (_label, request, path, response, expected) => {
    apiRequest.mockResolvedValueOnce(response);

    await expect(request('token')).resolves.toEqual(expected);
    expect(apiRequest).toHaveBeenCalledWith(path, { token: 'token' });
  });

  it.each([
    ['assistant name', updateAssistantName, '/api/settings/assistant-name', 'Atlas', { assistant_name: 'Atlas' }, { assistant_name: 'Atlas' }],
    ['signature', updateSignature, '/api/settings/signature', 'Regards', { signature: 'Regards' }, { signature: 'Regards' }],
    ['avatar', updateAvatar, '/api/settings/avatar', '/avatars/2.png', { avatar_url: '/avatars/2.png' }, { avatar_url: '/avatars/2.png' }],
  ])('updates %s through the shared client', async (_label, request, path, value, body, response) => {
    apiRequest.mockResolvedValueOnce(response);

    await expect(request('token', value)).resolves.toBe(value);
    expect(apiRequest).toHaveBeenCalledWith(path, {
      method: 'PUT',
      token: 'token',
      body,
    });
  });
});
