import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  getAssistantName,
  getAvatar,
  getAvatarPresets,
  createSignature,
  deleteSignature,
  getSignatures,
  getUsageStats,
  setDefaultSignature,
  getTeamInfo,
  updateAssistantName,
  updateAvatar,
  updateSignature,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('settings API', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['assistant name', getAssistantName, '/api/settings/assistant-name', { assistant_name: 'Atlas' }, 'Atlas'],
    ['signatures', getSignatures, '/api/settings/signatures', { signatures: [{ id: '1' }] }, [{ id: '1' }]],
    ['avatar', getAvatar, '/api/settings/avatar', { avatar_url: '/avatars/2.png' }, '/avatars/2.png'],
    ['avatar presets', getAvatarPresets, '/api/settings/avatar-presets', { presets: [{ id: '2' }] }, [{ id: '2' }]],
    ['user and agent totals', getUsageStats, '/api/stats', { users: { registered: { total: 42 } }, agents: { by_agent: { supervisor: 3 } } }, { users: { registered: { total: 42 } }, agents: { by_agent: { supervisor: 3 } } }],
  ])('loads %s through the shared client', async (_label, request, path, response, expected) => {
    apiRequest.mockResolvedValueOnce(response);

    await expect(request('token')).resolves.toEqual(expected);
    expect(apiRequest).toHaveBeenCalledWith(path, { token: 'token' });
  });

  it.each([
    ['assistant name', updateAssistantName, '/api/settings/assistant-name', 'Atlas', { assistant_name: 'Atlas' }, { assistant_name: 'Atlas' }],
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

  it('loads team info through the shared client', async () => {
    const teamInfo = { model: 'gpt-5', agents: [] };
    apiRequest.mockResolvedValueOnce(teamInfo);

    await expect(getTeamInfo('token')).resolves.toEqual(teamInfo);
    expect(apiRequest).toHaveBeenCalledWith('/api/agent/team_info', { token: 'token' });
  });

  it('creates a signature template', async () => {
    apiRequest.mockResolvedValueOnce({ signature: { id: '1', name: 'Work' } });

    await expect(createSignature('token', { name: 'Work', content: '-- J' }))
      .resolves.toEqual({ id: '1', name: 'Work' });
    expect(apiRequest).toHaveBeenCalledWith('/api/settings/signatures', {
      method: 'POST',
      token: 'token',
      body: { name: 'Work', content: '-- J' },
    });
  });

  it('updates one template by id', async () => {
    apiRequest.mockResolvedValueOnce({ signature: { id: '1', name: 'Work' } });

    await expect(updateSignature('token', '1', { name: 'Work', content: '-- J' }))
      .resolves.toEqual({ id: '1', name: 'Work' });
    expect(apiRequest).toHaveBeenCalledWith('/api/settings/signatures/1', {
      method: 'PUT',
      token: 'token',
      body: { name: 'Work', content: '-- J' },
    });
  });

  it('returns the whole list when promoting a default, since another row changed too', async () => {
    apiRequest.mockResolvedValueOnce({ signatures: [{ id: '2', is_default: true }] });

    await expect(setDefaultSignature('token', '2')).resolves.toEqual([{ id: '2', is_default: true }]);
    expect(apiRequest).toHaveBeenCalledWith('/api/settings/signatures/2/default', {
      method: 'PUT',
      token: 'token',
    });
  });

  it('deletes a template by id', async () => {
    apiRequest.mockResolvedValueOnce(null);

    await expect(deleteSignature('token', '3')).resolves.toBe('3');
    expect(apiRequest).toHaveBeenCalledWith('/api/settings/signatures/3', {
      method: 'DELETE',
      token: 'token',
    });
  });
});
