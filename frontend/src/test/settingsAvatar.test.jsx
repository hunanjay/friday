import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { WorkspaceContext } from '../context/workspace-context';
import SettingsPage from '../pages/SettingsPage';

const settingsState = vi.hoisted(() => ({}));

vi.mock('../features/settings/hooks', () => ({
  useAssistantName: () => ({
    assistantName: settingsState.assistantName,
    updateAssistantName: settingsState.handleUpdateAssistantName,
  }),
  useSignature: () => ({
    signature: settingsState.signature,
    updateSignature: settingsState.handleUpdateSignature,
  }),
  useAvatar: () => ({
    avatarUrl: settingsState.avatarUrl,
    updateAvatar: settingsState.handleUpdateAvatar,
  }),
  useAvatarPresets: () => ({ avatarPresets: settingsState.avatarPresets }),
}));

function renderSettings(overrides = {}) {
  Object.assign(settingsState, {
    assistantName: 'Friday',
    handleUpdateAssistantName: vi.fn(),
    signature: '',
    handleUpdateSignature: vi.fn(),
    avatarUrl: '/avatars/avatar-01.png',
    avatarPresets: [{ id: 'avatar-01.png', url: '/avatars/avatar-01.png' }],
    handleUpdateAvatar: vi.fn().mockResolvedValue('/avatars/avatar-01.png'),
  }, overrides);

  const value = {
    user: { name: 'Test User', email: 'test@example.com' },
    theme: 'light',
    toggleTheme: vi.fn(),
    handleLogout: vi.fn(),
    githubStatus: { connected: false },
    githubRepos: { available: [], selected: [] },
    handleConnectGithub: vi.fn(),
    handleDisconnectGithub: vi.fn(),
    handleSaveGithubRepos: vi.fn(),
    mailAccounts: [],
    handleUnbindMailAccount: vi.fn(),
    handleVerifyMailAccount: vi.fn(),
    handleRefreshMailAccounts: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <SettingsPage />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  );
  return { ...value, ...settingsState };
}

describe('SettingsPage assistant avatar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the currently selected preset with a check', () => {
    renderSettings();
    expect(screen.getByTitle('avatar-01.png (current)')).toHaveClass('selected');
  });

  it('clicking the already-selected preset gives visible feedback instead of doing nothing', () => {
    const { showToast, handleUpdateAvatar } = renderSettings();
    fireEvent.click(screen.getByTitle('avatar-01.png (current)'));
    expect(handleUpdateAvatar).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/already your current avatar/i));
  });

  it('clicking a different preset saves it and confirms via toast', async () => {
    const { showToast, handleUpdateAvatar } = renderSettings({
      avatarUrl: '/avatars/avatar-01.png',
      avatarPresets: [
        { id: 'avatar-01.png', url: '/avatars/avatar-01.png' },
        { id: 'avatar-02.png', url: '/avatars/avatar-02.png' },
      ],
    });
    await act(async () => fireEvent.click(screen.getByTitle('avatar-02.png')));
    expect(handleUpdateAvatar).toHaveBeenCalledWith('/avatars/avatar-02.png');
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/avatar updated/i));
  });

  it('surfaces a failure via toast instead of failing silently', async () => {
    const { showToast } = renderSettings({
      avatarUrl: '/avatars/avatar-01.png',
      avatarPresets: [
        { id: 'avatar-01.png', url: '/avatars/avatar-01.png' },
        { id: 'avatar-02.png', url: '/avatars/avatar-02.png' },
      ],
      handleUpdateAvatar: vi.fn().mockRejectedValue(new Error('network error')),
    });
    await act(async () => fireEvent.click(screen.getByTitle('avatar-02.png')));
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/failed to update/i));
  });
});
