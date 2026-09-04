import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bot20Regular,
  Code20Regular,
  Mail20Regular,
  Person20Regular,
  PeopleCommunity20Regular,
  PlugConnected20Regular,
} from '@fluentui/react-icons';
import { useAuth } from '../features/auth/useAuth';
import { useGitHubConnection, useGitHubRepositories } from '../features/github/hooks';
import { useMailAccounts } from '../features/mail/accountHooks';
import { useAssistantName, useAvatar, useAvatarPresets, useTeamInfo, useUsageStats } from '../features/settings/hooks';
import { useTheme } from '../hooks/useTheme';
import { useUi } from '../hooks/useUi';
import { useTranslation } from 'react-i18next';
import BindMailAccountModal from '../components/BindMailAccountModal';
import SignatureTemplates from '../components/SignatureTemplates';
import UsageStatsPanel from '../components/UsageStatsPanel';
import { Github, Search, X, Moon, Sun, LogOut, Mail, CheckCircle, Plus, ChevronRight, RefreshCw, MicrosoftIcon } from '../components/common/Icons';

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { section = 'general' } = useParams();
  const { assistantName, updateAssistantName } = useAssistantName();
  const { avatarUrl, updateAvatar } = useAvatar();
  const { avatarPresets } = useAvatarPresets();
  const { githubStatus, connectGitHub, disconnectGitHub } = useGitHubConnection();
  const { githubRepositories, saveGitHubRepositories } = useGitHubRepositories({
    enabled: Boolean(githubStatus?.connected),
  });
  const { mailAccounts, unbindMailAccount, verifyMailAccount } = useMailAccounts();
  const { teamInfo, isLoadingTeamInfo: isLoadingTeam, teamInfoError: teamError, loadTeamInfo } = useTeamInfo();
  // 403 for non-admins, so the whole section simply does not exist for them.
  const { usageStats, usageStatsError, isUsageStatsForbidden } = useUsageStats();
  const {
    user,
    handleLogout,
    handleSwitchAccount,
    handleMsLogout,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useUi();

  const { t, i18n } = useTranslation();
  const changeLanguage = (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  };
  const [checked, setChecked] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBindMail, setShowBindMail] = useState(false);
  const [verifyingMailId, setVerifyingMailId] = useState(null);
  const [assistantNameDraft, setAssistantNameDraft] = useState(assistantName);
  const [isSavingAssistantName, setIsSavingAssistantName] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const addRepoRef = useRef(null);
  const [showSupervisorPrompt, setShowSupervisorPrompt] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState(new Set());
  const selectedCommit = location.state?.commit;

  // Client-side navigation (e.g. from the chat approval card) doesn't
  // trigger the browser's native anchor scroll, so do it ourselves.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const toggleAgentExpanded = (name) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Close the "Add repo" dropdown on an outside click.
  useEffect(() => {
    if (!showAddRepo) return;
    const onClickOutside = (e) => {
      if (addRepoRef.current && !addRepoRef.current.contains(e.target)) {
        setShowAddRepo(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showAddRepo]);

  useEffect(() => {
    setAssistantNameDraft(assistantName);
  }, [assistantName]);

  // Sync the local picker draft whenever the server-backed selection changes.
  useEffect(() => {
    if (githubRepositories.selected) {
      setChecked(new Set(githubRepositories.selected));
    }
  }, [githubRepositories]);

  const toggleRepo = (fullName) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else {
        next.add(fullName);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveGitHubRepositories(Array.from(checked));
      showToast(i18n.language === 'zh' ? 'GitHub 仓库配置已保存' : 'GitHub repos selection saved');
    } catch {
      showToast(i18n.language === 'zh' ? '保存失败' : 'Failed to save repo selection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAssistantName = async () => {
    const name = assistantNameDraft.trim();
    if (!name || name === assistantName) return;
    setIsSavingAssistantName(true);
    try {
      await updateAssistantName(name);
      showToast(isZh ? '助手名称已更新' : 'Assistant name updated');
    } catch {
      showToast(isZh ? '更新失败' : 'Failed to update assistant name');
    } finally {
      setIsSavingAssistantName(false);
    }
  };

  const handleSelectAvatar = async (url) => {
    if (isSavingAvatar) return;
    // Still confirm on click even when this is already the active avatar -
    // a silent no-op is indistinguishable from a broken button, especially
    // with only one preset where every click is "already selected".
    if (url === avatarUrl) {
      showToast(isZh ? '这已经是当前头像' : 'This is already your current avatar');
      return;
    }
    setIsSavingAvatar(true);
    try {
      await updateAvatar(url);
      showToast(isZh ? '头像已更新' : 'Avatar updated');
    } catch {
      showToast(isZh ? '更新失败' : 'Failed to update avatar');
    } finally {
      setIsSavingAvatar(false);
    }
  };

  const handleDisconnect = async () => {
    if (confirm(i18n.language === 'zh' ? '确定要断开与 GitHub 的连接吗？' : 'Are you sure you want to disconnect from GitHub?')) {
      setIsDisconnecting(true);
      try {
        await disconnectGitHub();
        showToast(i18n.language === 'zh' ? 'GitHub 已断开连接' : 'GitHub disconnected');
      } catch {
        showToast(i18n.language === 'zh' ? '断开连接失败' : 'Failed to disconnect');
      } finally {
        setIsDisconnecting(false);
      }
    }
  };

  const selectedRepos = useMemo(
    () => githubRepositories.available.filter(r => checked.has(r.full_name)),
    [githubRepositories.available, checked]
  );

  // Repos still available to add, filtered by the dropdown's search box.
  const addableRepos = useMemo(() => {
    return githubRepositories.available.filter(r =>
      !checked.has(r.full_name) && r.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [githubRepositories.available, checked, searchQuery]);

  const isZh = i18n.language === 'zh';
  // The approval card links here with #signature to fix a sign-off mid-send,
  // so that hash has to land in an open editor.
  const signatureAutoEdit = location.hash === '#signature';
  const validSections = new Set(['general', 'assistant', 'github', 'mail', 'advanced', 'usage']);
  const activeSection = validSections.has(section) ? section : null;
  const pageMeta = {
    general: {
      title: isZh ? '账号与偏好' : 'Account & preferences',
      description: isZh ? '管理登录账号、界面外观和语言。' : 'Manage your account, appearance, and interface language.',
    },
    assistant: {
      title: isZh ? '助手' : 'Assistant',
      description: isZh ? '设置助手在聊天和邮件中的名称与头像。' : 'Choose how your assistant appears in chat and email.',
    },
    github: {
      title: 'GitHub',
      description: isZh ? '管理 GitHub 连接和日报数据范围。' : 'Manage your GitHub connection and reporting scope.',
    },
    mail: {
      title: isZh ? '邮箱账号' : 'Mail accounts',
      description: isZh ? '管理发件签名、邮箱连接和凭据状态。' : 'Manage your signature, mail connections, and credential status.',
    },
    advanced: {
      title: isZh ? '开发者设置' : 'Developer settings',
      description: isZh ? '检查智能体团队配置和实际运行提示。' : 'Inspect the agent team configuration and runtime prompts.',
    },
    usage: {
      title: isZh ? '用户量' : 'Users',
      description: isZh ? '查看注册用户总数和每个 Agent 的累计调用次数。' : 'See total registered users and all-time calls by agent.',
    },
  };
  const closeCommitDetails = () => navigate('/settings/github', { replace: true, state: null });
  const commitUrl = selectedCommit?.repo && selectedCommit?.sha
    ? `https://github.com/${selectedCommit.repo}/commit/${selectedCommit.sha}`
    : null;
  const commitDate = selectedCommit?.date
    ? new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Shanghai',
    }).format(new Date(selectedCommit.date))
    : '';

  if (!activeSection || (activeSection === 'usage' && isUsageStatsForbidden)) {
    return <Navigate to="/settings/general" replace />;
  }

  const activeMeta = pageMeta[activeSection];

  return (
    <div className="settings-page-container">
      <div className="settings-page-header">
        <span className="settings-page-kicker">{isZh ? '偏好设置' : 'Preferences'}</span>
        <h1>{activeMeta.title}</h1>
        <p className="settings-page-subtitle">
          {activeMeta.description}
        </p>
      </div>

      <div className="settings-shell">
        <nav className="settings-section-nav" aria-label={isZh ? '设置分类' : 'Settings sections'}>
          <div className="settings-nav-group">
            <div className="settings-nav-label">{isZh ? '个人' : 'Personal'}</div>
            <NavLink to="/settings/general" className={({ isActive }) => isActive ? 'current' : ''}>
              <Person20Regular />
              <span>{isZh ? '账号与偏好' : 'Account & preferences'}</span>
            </NavLink>
            <NavLink to="/settings/assistant" className={({ isActive }) => isActive ? 'current' : ''}>
              <Bot20Regular />
              <span>{isZh ? '助手' : 'Assistant'}</span>
            </NavLink>
          </div>
          <div className="settings-nav-group">
            <div className="settings-nav-label">{isZh ? '连接' : 'Connections'}</div>
            <NavLink to="/settings/mail" className={({ isActive }) => isActive ? 'current' : ''}>
              <Mail20Regular />
              <span>{isZh ? '邮箱账号' : 'Mail accounts'}</span>
            </NavLink>
            <NavLink to="/settings/github" className={({ isActive }) => isActive ? 'current' : ''}>
              <PlugConnected20Regular />
              <span>GitHub</span>
            </NavLink>
          </div>
          <div className="settings-nav-group">
            <div className="settings-nav-label">{isZh ? '系统' : 'System'}</div>
            {(usageStats || usageStatsError || activeSection === 'usage') && (
              <NavLink to="/settings/usage" className={({ isActive }) => isActive ? 'current' : ''}>
                <PeopleCommunity20Regular />
                <span>{isZh ? '用户量' : 'Users'}</span>
              </NavLink>
            )}
            <NavLink to="/settings/advanced" className={({ isActive }) => isActive ? 'current' : ''}>
              <Code20Regular />
              <span>{isZh ? '开发者' : 'Developer'}</span>
            </NavLink>
          </div>
        </nav>

        <div className="settings-panes">
          {activeSection === 'general' && (
            <>
          {user && (
            <section className="settings-pane" id="profile">
              <div className="settings-pane-head"><h2>{isZh ? '账号' : 'Account'}</h2></div>
              <div className="settings-panel">
                <div className="settings-row">
                  <div className="settings-identity">{user.name ? user.name[0].toUpperCase() : 'U'}</div>
                  <div className="settings-id">
                    <div className="settings-id-primary">{user.name}</div>
                    <div className="settings-id-meta">{user.email}</div>
                  </div>
                  <div className="settings-row-actions">
                    <button className="settings-btn" onClick={handleSwitchAccount}>
                      <RefreshCw size={16} />
                      <span>{t('common.switchMsAccount')}</span>
                    </button>
                    <button className="settings-btn btn-danger" onClick={handleMsLogout} title={t('common.signOutMsHint')}>
                      <MicrosoftIcon size={16} />
                      <span>{t('common.signOutMs')}</span>
                    </button>
                    <button className="settings-btn btn-danger" onClick={handleLogout}>
                      <LogOut size={16} />
                      <span>{t('common.signOut')}</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="settings-pane" id="general">
            <div className="settings-pane-head"><h2>{isZh ? '常规' : 'General'}</h2></div>
            <div className="settings-panel">
              <div className="settings-field-row">
                <div>
                  <div className="settings-field-label">{isZh ? '外观' : 'Appearance'}</div>
                </div>
                <div className="settings-segmented">
                  <button className={theme === 'light' ? 'on' : ''} onClick={() => theme !== 'light' && toggleTheme()}>
                    <Sun size={14} style={{ marginRight: 5, verticalAlign: -2 }} />{t('common.themeLight')}
                  </button>
                  <button className={theme === 'dark' ? 'on' : ''} onClick={() => theme !== 'dark' && toggleTheme()}>
                    <Moon size={14} style={{ marginRight: 5, verticalAlign: -2 }} />{t('common.themeDark')}
                  </button>
                </div>
              </div>
              <div className="settings-field-row">
                <div>
                  <div className="settings-field-label">{isZh ? '界面语言' : 'Language'}</div>
                  <div className="settings-field-hint">{isZh ? '聊天与邮件正文不受影响' : "Doesn't affect chat or mail content"}</div>
                </div>
                <div className="settings-segmented">
                  <button className={i18n.language === 'zh' ? 'on' : ''} onClick={() => changeLanguage('zh')}>中文</button>
                  <button className={i18n.language === 'en' ? 'on' : ''} onClick={() => changeLanguage('en')}>EN</button>
                </div>
              </div>
            </div>
          </section>
            </>
          )}

          {activeSection === 'assistant' && (
          <section className="settings-pane" id="assistant">
            <div className="settings-pane-head"><h2>{isZh ? '助手' : 'Assistant'}</h2></div>
            <div className="settings-panel">
              <div className="settings-field-row">
                <div>
                  <div className="settings-field-label">{isZh ? '助手名称' : 'Assistant Name'}</div>
                  <div className="settings-field-hint">{isZh ? '自定义 AI 助手在聊天和邮件中显示的名字。' : 'Customize the name your AI assistant uses in chat and email.'}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="settings-text-input"
                    value={assistantNameDraft}
                    maxLength={40}
                    onChange={(e) => setAssistantNameDraft(e.target.value)}
                    placeholder="Friday"
                  />
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={isSavingAssistantName || !assistantNameDraft.trim() || assistantNameDraft.trim() === assistantName}
                    onClick={handleSaveAssistantName}
                  >
                    {isSavingAssistantName ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存' : 'Save')}
                  </button>
                </div>
              </div>
              <div className="settings-field-row">
                <div>
                  <div className="settings-field-label">{isZh ? '助手头像' : 'Assistant Avatar'}</div>
                  <div className="settings-field-hint">{isZh ? '选择聊天和邮件中显示的头像。' : 'Choose the avatar shown in chat and email.'}</div>
                </div>
                <div>
                  <div className="avatar-preset-grid">
                    {avatarPresets.map((preset) => {
                      const isSelected = avatarUrl === preset.url;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`avatar-preset-tile ${isSelected ? 'selected' : ''}`}
                          disabled={isSavingAvatar}
                          onClick={() => handleSelectAvatar(preset.url)}
                          title={isSelected ? (isZh ? `${preset.id}（当前）` : `${preset.id} (current)`) : preset.id}
                        >
                          <img src={preset.url} alt={preset.id} />
                          {isSelected && (
                            <span className="avatar-preset-tile-check" aria-hidden="true">
                              <CheckCircle size={16} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {avatarPresets.length === 0 && (
                      <p className="settings-field-hint">{isZh ? '暂无可选头像' : 'No presets available'}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
          )}

          {activeSection === 'github' && (
          <section className="settings-pane" id="github">
            <div className="settings-pane-head">
              <div className="settings-pane-title">
                <h2>GitHub</h2>
                <span className="beta-badge">{t('common.beta')}</span>
              </div>
              {githubStatus?.connected && (
                <span className="settings-pane-count">{checked.size} / {githubRepositories.available.length} {isZh ? '仓库已选' : 'repos selected'}</span>
              )}
            </div>
            <div className="settings-panel">
              <div className="settings-row">
                {githubStatus?.connected ? (
                  githubStatus.avatar_url ? (
                    <img src={githubStatus.avatar_url} alt={githubStatus.login} className="settings-github-avatar" />
                  ) : (
                    <div className="settings-github-avatar-fallback"><Github size={20} /></div>
                  )
                ) : (
                  <div className="settings-identity"><Github size={18} /></div>
                )}
                <div className="settings-id">
                  <div className="settings-id-primary">
                    {githubStatus?.connected ? (githubStatus.name || githubStatus.login) : (isZh ? '未连接' : 'Not connected')}
                  </div>
                  <div className="settings-id-meta">
                    {githubStatus?.connected ? `@${githubStatus.login}` : (isZh ? '连接后可导入 commit 生成日报' : 'Connect to import commits for status reports')}
                    {githubStatus?.connected ? (
                      <span className="github-status-indicator connected"><span className="pulse-dot" />{isZh ? '已连接' : 'Connected'}</span>
                    ) : (
                      <span className="github-status-indicator disconnected">{isZh ? '未连接' : 'Not Connected'}</span>
                    )}
                  </div>
                </div>
                <div className="settings-row-actions">
                  {githubStatus?.connected ? (
                    <>
                      <button type="button" className="settings-btn" onClick={connectGitHub} title="Reconnect GitHub">
                        {isZh ? '重新连接' : 'Reconnect'}
                      </button>
                      <button type="button" className="settings-btn btn-danger-outline" onClick={handleDisconnect} disabled={isDisconnecting}>
                        {isDisconnecting ? '...' : (isZh ? '断开连接' : 'Disconnect')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="settings-btn btn-primary" onClick={connectGitHub}>
                      {isZh ? '连接 GitHub' : 'Connect GitHub'}
                    </button>
                  )}
                </div>
              </div>

              {githubStatus?.connected && (
                <div className="github-repositories-section">
                  <div className="repo-section-header">
                    <h3>{isZh ? '要汇报进度的仓库' : 'Repositories for Status Reports'}</h3>
                    <p className="repo-section-desc">
                      {isZh ? '选择哪些仓库的 commit 活动需要生成报告。' : 'Choose which repositories to pull commit history from.'}
                    </p>
                  </div>

                  {githubRepositories.available.length === 0 ? (
                    <div className="repos-empty-state">
                      <Github size={32} />
                      <p>{isZh ? '在您的 GitHub 账户中未找到任何仓库。' : 'No repositories found in your GitHub account.'}</p>
                    </div>
                  ) : (
                    <>
                      <div className="settings-repo-grid">
                        {selectedRepos.map(r => (
                          <div key={r.full_name} className="settings-repo-chip is-selected">
                            <span className="settings-repo-name" title={r.full_name}>{r.full_name}</span>
                            <button
                              type="button"
                              className="repo-remove-btn"
                              onClick={() => toggleRepo(r.full_name)}
                              aria-label={isZh ? '移除仓库' : 'Remove repository'}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                      {selectedRepos.length === 0 && (
                        <p className="settings-field-hint">{isZh ? '还没有选择仓库。' : 'No repositories selected yet.'}</p>
                      )}

                      <div className="repo-add-wrapper" ref={addRepoRef}>
                        <button
                          type="button"
                          className="settings-btn"
                          onClick={() => setShowAddRepo(v => !v)}
                        >
                          <Plus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                          {isZh ? '添加仓库' : 'Add repo'}
                        </button>

                        {showAddRepo && (
                          <div className="repo-add-dropdown">
                            <div className="settings-search-wrapper">
                              <Search size={16} className="settings-search-icon" />
                              <input
                                type="text"
                                placeholder={isZh ? "搜索仓库..." : "Search repositories..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="settings-search-input"
                                autoFocus
                              />
                              {searchQuery && (
                                <button type="button" className="settings-search-clear" onClick={() => setSearchQuery('')}>
                                  <X size={16} />
                                </button>
                              )}
                            </div>
                            <div className="repo-add-dropdown-list">
                              {addableRepos.length === 0 ? (
                                <p className="settings-field-hint">
                                  {searchQuery
                                    ? (isZh ? '没有符合搜索条件的仓库。' : 'No repositories match your search.')
                                    : (isZh ? '所有仓库都已添加。' : 'All repositories are already added.')}
                                </p>
                              ) : (
                                addableRepos.map(r => (
                                  <button
                                    type="button"
                                    key={r.full_name}
                                    className="repo-add-option"
                                    onClick={() => toggleRepo(r.full_name)}
                                  >
                                    <span className="settings-repo-name" title={r.full_name}>{r.full_name}</span>
                                    <Plus size={14} />
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {githubStatus?.connected && (
                <div className="settings-pane-foot">
                  <span>{isZh ? '用于生成工作日报的 commit 数据来源' : 'Commit source for status report generation'}</span>
                  <button type="button" className="settings-btn btn-primary" onClick={handleSave} disabled={isSaving} style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
                    {isSaving ? (isZh ? '正在保存...' : 'Saving...') : (isZh ? '保存选择' : 'Save Selection')}
                  </button>
                </div>
              )}
            </div>
          </section>
          )}

          {activeSection === 'mail' && (
          <section className="settings-pane" id="mail">
            <div className="settings-pane-head">
              <div className="settings-pane-title">
                <h2>{isZh ? '邮箱账号' : 'Mail Accounts'}</h2>
                <span className="beta-badge">{t('common.beta')}</span>
              </div>
              <span className="settings-pane-count">{mailAccounts.length} {isZh ? '已绑定' : 'bound'}</span>
            </div>
            <p className="settings-callout">
              {isZh
                ? '支持 163 / QQ / Gmail / iCloud / Outlook（IMAP+SMTP）及自定义服务器，凭据加密存储。'
                : '163 / QQ / Gmail / iCloud / Outlook (IMAP+SMTP) and custom servers. Credentials are encrypted at rest.'}
            </p>
            <div className="settings-panel" id="signature">
              <SignatureTemplates isZh={isZh} showToast={showToast} autoEdit={signatureAutoEdit} />
            </div>
            <div className="settings-panel">
              {mailAccounts.length === 0 ? (
                <div className="github-disconnected-prompt">
                  <Mail size={36} className="disconnected-icon" />
                  <h3>{isZh ? '还没有绑定邮箱' : 'No mail accounts bound'}</h3>
                  <p>
                    {isZh
                      ? '点击下方"绑定邮箱"，选择 163/QQ 等提供商并填入授权码即可连接。'
                      : 'Click "Bind Mail" below and pick a provider (163/QQ...) with its auth code.'}
                  </p>
                </div>
              ) : (
                mailAccounts.map(acc => (
                  <div key={acc.id} className="settings-row">
                    <div className="settings-id">
                      <div className="settings-id-primary">{acc.email_address}</div>
                      <div className="settings-id-meta">
                        {acc.provider}
                        {acc.last_verified_at ? (
                          <span className="settings-status-pill ok">{isZh ? '已验证' : 'verified'} {new Date(acc.last_verified_at).toLocaleDateString()}</span>
                        ) : (
                          <span className="settings-status-pill">{acc.status}</span>
                        )}
                      </div>
                    </div>
                    <div className="settings-row-actions">
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={async () => {
                          setVerifyingMailId(acc.id);
                          try {
                            await verifyMailAccount(acc.id);
                            showToast(isZh ? '连接正常' : 'Connection OK');
                          } catch {
                            showToast(isZh ? '连接验证失败' : 'Verification failed');
                          } finally {
                            setVerifyingMailId(null);
                          }
                        }}
                        disabled={verifyingMailId === acc.id}
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      >
                        {verifyingMailId === acc.id ? '...' : (isZh ? '测试连接' : 'Verify')}
                      </button>
                      <button
                        type="button"
                        className="settings-btn btn-danger"
                        onClick={async () => {
                          if (!confirm(isZh ? `解绑 ${acc.email_address}？` : `Unbind ${acc.email_address}?`)) return;
                          try {
                            await unbindMailAccount(acc.id);
                            showToast(isZh ? '已解绑' : 'Unbound');
                          } catch {
                            showToast(isZh ? '解绑失败' : 'Failed to unbind');
                          }
                        }}
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      >
                        {isZh ? '解绑' : 'Unbind'}
                      </button>
                    </div>
                  </div>
                ))
              )}
              <div className="settings-pane-foot">
                <span>{isZh ? '点击测试连接会重新校验 IMAP/SMTP 凭据' : 'Verify re-checks the IMAP/SMTP credentials'}</span>
                <button
                  type="button"
                  className="settings-btn btn-primary"
                  onClick={() => setShowBindMail(true)}
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                >
                  {isZh ? '+ 绑定邮箱' : '+ Bind Mail'}
                </button>
              </div>
            </div>
          </section>
          )}

          {activeSection === 'advanced' && (
          <section className="settings-pane" id="team">
            <div className="settings-pane-head">
              <h2>{isZh ? '智能体团队' : 'Agent Team'}</h2>
              {teamInfo && (
                <span className="settings-pane-count">
                  {teamInfo.agents.length} {isZh ? '个 agent' : 'agents'}
                </span>
              )}
            </div>
            <p className="settings-callout">
              {isZh
                ? '调试用：查看 supervisor 和每个 agent 当前实际发给模型的 system prompt，以及各自可用的工具及其描述。'
                : "Debug view: the supervisor's and each agent's actual system prompt sent to the model, plus their available tools and descriptions."}
            </p>
            <div className="settings-panel">
              {!teamInfo && !isLoadingTeam && !teamError && (
                <div className="settings-pane-foot" style={{ borderTop: 'none' }}>
                  <span>{isZh ? '尚未加载' : 'Not loaded yet'}</span>
                  <button type="button" className="settings-btn btn-primary" onClick={loadTeamInfo} style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
                    {isZh ? '加载' : 'Load'}
                  </button>
                </div>
              )}
              {isLoadingTeam && (
                <div className="settings-row"><span className="settings-field-hint">{isZh ? '加载中...' : 'Loading...'}</span></div>
              )}
              {teamError && !isLoadingTeam && (
                <div className="settings-pane-foot" style={{ borderTop: 'none' }}>
                  <span className="settings-field-hint">{isZh ? '加载失败' : 'Failed to load'}</span>
                  <button type="button" className="settings-btn" onClick={loadTeamInfo} style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
                    {isZh ? '重试' : 'Retry'}
                  </button>
                </div>
              )}
              {teamInfo && (
                <>
                  <div className="team-agent-card">
                    <button
                      type="button"
                      className="team-agent-header"
                      onClick={() => setShowSupervisorPrompt(v => !v)}
                    >
                      <ChevronRight size={14} className={`team-chevron ${showSupervisorPrompt ? 'expanded' : ''}`} />
                      <span className="team-agent-name">supervisor</span>
                      <span className="settings-field-hint">{teamInfo.model}</span>
                    </button>
                    {showSupervisorPrompt && (
                      <pre className="team-prompt-pre">{teamInfo.supervisor.system_prompt}</pre>
                    )}
                  </div>

                  {teamInfo.agents.map(agent => {
                    const isExpanded = expandedAgents.has(agent.name);
                    return (
                      <div key={agent.name} className="team-agent-card">
                        <button
                          type="button"
                          className="team-agent-header"
                          onClick={() => toggleAgentExpanded(agent.name)}
                        >
                          <ChevronRight size={14} className={`team-chevron ${isExpanded ? 'expanded' : ''}`} />
                          <span className="team-agent-name">{agent.name}</span>
                          <span className="settings-field-hint">
                            {agent.tools.length} {isZh ? '个工具' : 'tools'}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="team-agent-body">
                            <div className="team-agent-subhead">{isZh ? '路由提示' : 'Routing hint'}</div>
                            <p className="settings-field-hint">{agent.routing_hint}</p>
                            <div className="team-agent-subhead">System prompt</div>
                            <pre className="team-prompt-pre">{agent.system_prompt}</pre>
                            <div className="team-agent-subhead">{isZh ? '工具' : 'Tools'}</div>
                            {agent.tools.map(tool => (
                              <div key={tool.name} className="team-tool-item">
                                <div className="team-tool-name">{tool.name}</div>
                                <div className="team-tool-desc">{tool.description}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="settings-pane-foot">
                    <span>{isZh ? '数据不会自动刷新' : 'Not auto-refreshed'}</span>
                    <button type="button" className="settings-btn" onClick={loadTeamInfo} style={{ padding: '6px 14px', fontSize: '0.82rem' }}>
                      {isZh ? '刷新' : 'Refresh'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
          )}

          {activeSection === 'usage' && (
            <section className="settings-pane" id="usage">
              <div className="settings-pane-head">
                <h2>{isZh ? '用户与 Agent' : 'Users and agents'}</h2>
              </div>
              <div className="usage-overview">
                {usageStats ? (
                  <UsageStatsPanel
                    stats={usageStats}
                    isZh={isZh}
                  />
                ) : usageStatsError ? (
                  <div className="usage-state" role="status">
                    {isZh ? '用户总数加载失败。' : 'Could not load the user count.'}
                  </div>
                ) : (
                  <div className="usage-state usage-state-loading" role="status">
                    <span className="usage-state-skeleton" aria-hidden="true" />
                    {isZh ? '正在加载用户总数...' : 'Loading user count...'}
                  </div>
                )}
              </div>
            </section>
          )}

        </div>
      </div>
      <BindMailAccountModal
        isOpen={showBindMail}
        onClose={() => setShowBindMail(false)}
        onBound={() => {
          showToast(i18n.language === 'zh' ? '邮箱绑定成功' : 'Mail account bound');
        }}
        isZh={isZh}
      />
      {selectedCommit && (
        <div className="settings-commit-detail-overlay" onClick={closeCommitDetails}>
          <section className="settings-commit-detail" role="dialog" aria-modal="true" aria-labelledby="commit-detail-title" onClick={event => event.stopPropagation()}>
            <div className="settings-commit-detail-header">
              <div>
                <span className="settings-commit-repo">{selectedCommit.repo}</span>
                <h2 id="commit-detail-title">{selectedCommit.message?.split('\n')[0] || (isZh ? '未命名提交' : 'Untitled commit')}</h2>
              </div>
              <button type="button" className="close-modal-btn" onClick={closeCommitDetails} aria-label={isZh ? '关闭提交详情' : 'Close commit details'}>
                <X size={18} />
              </button>
            </div>
            <dl className="settings-commit-detail-meta">
              <div><dt>{isZh ? '作者' : 'Author'}</dt><dd>{selectedCommit.author || '-'}</dd></div>
              <div><dt>{isZh ? '提交时间' : 'Committed'}</dt><dd>{commitDate || '-'}</dd></div>
              <div><dt>SHA</dt><dd><code>{selectedCommit.sha}</code></dd></div>
            </dl>
            {selectedCommit.message && <pre className="settings-commit-message">{selectedCommit.message}</pre>}
            <div className="settings-commit-detail-actions">
              {commitUrl && <a className="settings-btn btn-primary" href={commitUrl} target="_blank" rel="noreferrer">{isZh ? '在 GitHub 中查看' : 'View on GitHub'}</a>}
              <button type="button" className="settings-btn" onClick={closeCommitDetails}>{isZh ? '关闭' : 'Close'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
