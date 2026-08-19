import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { WorkspaceContext } from '../context/workspace-context';
import SettingsPage from '../pages/SettingsPage';

// SettingsPage reads everything through useWorkspace(), which is just
// useContext(WorkspaceContext) - so a real click-driven render doesn't need
// the actual Supabase/OAuth login flow, only this context filled in.
function renderSettings(overrides = {}) {
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
    assistantName: 'Friday',
    handleUpdateAssistantName: vi.fn(),
    avatarUrl: '/avatars/avatar-01.png',
    avatarPresets: [{ id: 'avatar-01.png', url: '/avatars/avatar-01.png' }],
    handleUpdateAvatar: vi.fn().mockResolvedValue('/avatars/avatar-01.png'),
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
  return value;
}

describe('SettingsPage assistant avatar', () => {
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
