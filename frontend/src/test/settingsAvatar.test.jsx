import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import SettingsPage from '../pages/SettingsPage';

const settingsState = vi.hoisted(() => ({}));
const githubState = vi.hoisted(() => ({}));
const mailState = vi.hoisted(() => ({}));
const providerState = vi.hoisted(() => ({}));

vi.mock('../features/auth/useAuth', () => ({
  useAuth: () => providerState.auth,
}));

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => providerState.theme,
}));

vi.mock('../hooks/useUi', () => ({
  useUi: () => providerState.ui,
}));

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
  useTeamInfo: () => ({
    teamInfo: null,
    isLoadingTeamInfo: false,
    teamInfoError: false,
    loadTeamInfo: () => {},
  }),
}));

vi.mock('../features/github/hooks', () => ({
  useGitHubConnection: () => ({
    githubStatus: githubState.githubStatus,
    connectGitHub: githubState.connectGitHub,
    disconnectGitHub: githubState.disconnectGitHub,
  }),
  useGitHubRepositories: () => ({
    githubRepositories: githubState.githubRepositories,
    saveGitHubRepositories: githubState.saveGitHubRepositories,
  }),
}));

vi.mock('../features/mail/accountHooks', () => ({
  useMailAccounts: () => ({
    mailAccounts: mailState.mailAccounts,
    bindMailAccount: mailState.bindMailAccount,
    unbindMailAccount: mailState.unbindMailAccount,
    verifyMailAccount: mailState.verifyMailAccount,
  }),
  useMailProviders: () => ({ mailProviders: mailState.mailProviders }),
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
  Object.assign(githubState, {
    githubStatus: { connected: false },
    githubRepositories: { available: [], selected: [] },
    connectGitHub: vi.fn(),
    disconnectGitHub: vi.fn(),
    saveGitHubRepositories: vi.fn(),
  }, overrides);
  Object.assign(mailState, {
    mailAccounts: [],
    mailProviders: [],
    bindMailAccount: vi.fn(),
    unbindMailAccount: vi.fn(),
    verifyMailAccount: vi.fn(),
  }, overrides);

  const value = {
    user: { name: 'Test User', email: 'test@example.com' },
    theme: 'light',
    toggleTheme: vi.fn(),
    handleLogout: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
  providerState.auth = {
    user: value.user,
    authToken: value.authToken,
    handleLogout: value.handleLogout,
    handleSwitchAccount: value.handleSwitchAccount,
    handleMsLogout: value.handleMsLogout,
  };
  providerState.theme = { theme: value.theme, toggleTheme: value.toggleTheme };
  providerState.ui = { showToast: value.showToast };
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
  return { ...value, ...settingsState, ...githubState, ...mailState };
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
