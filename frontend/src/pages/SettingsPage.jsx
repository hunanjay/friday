import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';
import { Github, Search, X, Moon, Sun, LogOut } from '../components/common/Icons';
import LanguageSwitcher from '../components/common/LanguageSwitcher';

function RepoSection({ label, repos, checked, onToggle }) {
  if (repos.length === 0) return null;
  return (
    <div className="settings-repo-section">
      <h3 className="settings-repo-section-title">{label}</h3>
      <div className="settings-repo-grid">
        {repos.map(r => {
          const isChecked = checked.has(r.full_name);
          return (
            <label key={r.full_name} className={`settings-repo-card ${isChecked ? 'is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(r.full_name)}
                className="visually-hidden"
              />
              <div className="settings-repo-card-header">
                <span className="settings-repo-checkbox" aria-hidden="true" />
                <span className="settings-repo-badge">
                  {r.private ? (
                    <span className="badge-private">
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '3px' }}>
                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      Private
                    </span>
                  ) : (
                    <span className="badge-public">
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '3px' }}>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                        <path d="M2 12h20" />
                      </svg>
                      Public
                    </span>
                  )}
                </span>
              </div>
              <div className="settings-repo-name" title={r.full_name}>
                {r.full_name}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    theme,
    toggleTheme,
    handleLogout,
    githubStatus,
    githubRepos,
    handleConnectGithub,
    handleDisconnectGithub,
    handleSaveGithubRepos,
    showToast,
  } = useWorkspace();

  const { t, i18n } = useTranslation();
  const [checked, setChecked] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const selectedCommit = location.state?.commit;

  // Sync selection state from context when ready
  useEffect(() => {
    if (githubRepos?.selected) {
      setChecked(new Set(githubRepos.selected));
    }
  }, [githubRepos]);

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
      await handleSaveGithubRepos(Array.from(checked));
      showToast(i18n.language === 'zh' ? 'GitHub 仓库配置已保存' : 'GitHub repos selection saved');
    } catch {
      showToast(i18n.language === 'zh' ? '保存失败' : 'Failed to save repo selection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (confirm(i18n.language === 'zh' ? '确定要断开与 GitHub 的连接吗？' : 'Are you sure you want to disconnect from GitHub?')) {
      setIsDisconnecting(true);
      try {
        await handleDisconnectGithub();
        showToast(i18n.language === 'zh' ? 'GitHub 已断开连接' : 'GitHub disconnected');
      } catch {
        showToast(i18n.language === 'zh' ? '断开连接失败' : 'Failed to disconnect');
      } finally {
        setIsDisconnecting(false);
      }
    }
  };

  // Filter and group repos
  const filteredRepos = useMemo(() => {
    if (!githubRepos?.available) return [];
    return githubRepos.available.filter(r =>
      r.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [githubRepos?.available, searchQuery]);

  const privateRepos = useMemo(() => filteredRepos.filter(r => r.private), [filteredRepos]);
  const publicRepos = useMemo(() => filteredRepos.filter(r => !r.private), [filteredRepos]);

  const handleSelectAllFiltered = () => {
    setChecked(prev => {
      const next = new Set(prev);
      filteredRepos.forEach(r => next.add(r.full_name));
      return next;
    });
  };

  const handleClearAllFiltered = () => {
    setChecked(prev => {
      const next = new Set(prev);
      filteredRepos.forEach(r => next.delete(r.full_name));
      return next;
    });
  };

  const isZh = i18n.language === 'zh';
  const closeCommitDetails = () => navigate('/settings', { replace: true, state: null });
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

  return (
    <div className="settings-page-container">
      <div className="settings-page-header">
        <h1>{isZh ? '偏好设置' : 'Preferences'}</h1>
        <p className="settings-page-subtitle">
          {isZh ? '管理你的应用偏好、GitHub 连接以及仓库数据访问权限。' : 'Manage your application theme, languages, GitHub connection, and data scopes.'}
        </p>
      </div>

      <div className="settings-layout-grid">
        {/* Left Column: Preferences */}
        <div className="settings-sidebar-column">
          {/* User Profile Info */}
          {user && (
            <div className="settings-card profile-card">
              <div className="profile-header">
                <div className="profile-avatar">
                  {user.name ? user.name[0].toUpperCase() : 'U'}
                </div>
                <div className="profile-details">
                  <h3>{user.name}</h3>
                  <p>{user.email}</p>
                </div>
              </div>
              <button className="settings-btn btn-danger" onClick={handleLogout} style={{ marginTop: '16px', width: '100%' }}>
                <LogOut size={16} />
                <span>{t('common.signOut')}</span>
              </button>
            </div>
          )}

          {/* General Preferences card */}
          <div className="settings-card">
            <h2>{isZh ? '常规设置' : 'General Options'}</h2>
            
            <div className="setting-field">
              <label>{isZh ? '外观主题' : 'Appearance Theme'}</label>
              <div className="theme-selector-cards">
                <button 
                  className={`theme-card ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => theme !== 'light' && toggleTheme()}
                >
                  <Sun size={20} />
                  <span>{t('common.themeLight')}</span>
                </button>
                <button 
                  className={`theme-card ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => theme !== 'dark' && toggleTheme()}
                >
                  <Moon size={20} />
                  <span>{t('common.themeDark')}</span>
                </button>
              </div>
            </div>

            <div className="setting-field" style={{ marginTop: '20px' }}>
              <label>{isZh ? '界面语言' : 'Language'}</label>
              <div style={{ marginTop: '8px' }}>
                <LanguageSwitcher isSidebarCollapsed={false} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: GitHub Repository Selection (Takes more space) */}
        <div className="settings-main-column">
          <div className="settings-card main-github-card">
            <div className="github-card-header">
              <div className="github-card-title">
                <Github size={24} />
                <h2>GitHub {isZh ? '集成' : 'Integration'}</h2>
              </div>
              {githubStatus?.connected ? (
                <div className="github-status-indicator connected">
                  <span className="pulse-dot" />
                  {isZh ? '已连接' : 'Connected'}
                </div>
              ) : (
                <div className="github-status-indicator disconnected">
                  {isZh ? '未连接' : 'Not Connected'}
                </div>
              )}
            </div>

            {githubStatus?.connected ? (
              <>
                <div className="github-profile-horizontal">
                  <div className="github-profile-left">
                    {githubStatus.avatar_url ? (
                      <img src={githubStatus.avatar_url} alt={githubStatus.login} className="settings-github-avatar" />
                    ) : (
                      <div className="settings-github-avatar-fallback">
                        <Github size={20} />
                      </div>
                    )}
                    <div className="github-profile-text">
                      <span className="github-profile-fullname">{githubStatus.name || githubStatus.login}</span>
                      <span className="github-profile-login">@{githubStatus.login}</span>
                    </div>
                  </div>
                  <div className="github-profile-right">
                    <button type="button" className="settings-btn" onClick={handleConnectGithub} title="Reconnect GitHub">
                      {isZh ? '重新连接' : 'Reconnect'}
                    </button>
                    <button type="button" className="settings-btn btn-danger-outline" onClick={handleDisconnect} disabled={isDisconnecting}>
                      {isDisconnecting ? '...' : (isZh ? '断开连接' : 'Disconnect')}
                    </button>
                  </div>
                </div>

                <div className="github-repositories-section">
                  <div className="repo-section-header">
                    <div>
                      <h3>{isZh ? '要汇报进度的仓库' : 'Repositories for Status Reports'}</h3>
                      <p className="repo-section-desc">
                        {isZh ? `选择哪些仓库的 commit 活动需要生成报告。已选择 ${checked.size} 个。` : `Choose which repositories to pull commit history from. Selected ${checked.size} repositories.`}
                      </p>
                    </div>
                  </div>

                  <div className="repo-filter-controls">
                    <div className="settings-search-wrapper">
                      <Search size={16} className="settings-search-icon" />
                      <input
                        type="text"
                        placeholder={isZh ? "搜索仓库..." : "Search repositories..."}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="settings-search-input"
                      />
                      {searchQuery && (
                        <button type="button" className="settings-search-clear" onClick={() => setSearchQuery('')}>
                          <X size={16} />
                        </button>
                      )}
                    </div>

                    {filteredRepos.length > 0 && (
                      <div className="repo-selection-helpers">
                        <button type="button" onClick={handleSelectAllFiltered} className="helper-link-btn">
                          {isZh ? '全选匹配' : 'Select all matching'}
                        </button>
                        <span className="helper-separator">•</span>
                        <button type="button" onClick={handleClearAllFiltered} className="helper-link-btn">
                          {isZh ? '全部取消匹配' : 'Clear all matching'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="settings-repos-scrollable">
                    {githubRepos?.available?.length === 0 ? (
                      <div className="repos-empty-state">
                        <Github size={32} />
                        <p>{isZh ? '在您的 GitHub 账户中未找到任何仓库。' : 'No repositories found in your GitHub account.'}</p>
                      </div>
                    ) : filteredRepos.length === 0 ? (
                      <div className="repos-empty-state">
                        <p>{isZh ? '没有符合搜索条件的仓库。' : 'No repositories match your search.'}</p>
                      </div>
                    ) : (
                      <>
                        <RepoSection label={isZh ? "私有仓库" : "Private Repositories"} repos={privateRepos} checked={checked} onToggle={toggleRepo} />
                        <RepoSection label={isZh ? "公开仓库" : "Public Repositories"} repos={publicRepos} checked={checked} onToggle={toggleRepo} />
                      </>
                    )}
                  </div>

                  <div className="repo-section-footer">
                    <button type="button" className="settings-btn btn-primary" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? (isZh ? '正在保存...' : 'Saving...') : (isZh ? '保存仓库选择' : 'Save Repository Selection')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="github-disconnected-prompt">
                <Github size={48} className="disconnected-icon" />
                <h3>{isZh ? '连接您的 GitHub 账号' : 'Connect Your GitHub Account'}</h3>
                <p>
                  {isZh 
                    ? '连接 GitHub 账号以导入您在各个仓库的提交记录，并生成工作日报。' 
                    : 'Connect your GitHub profile to import repository commit history and analyze daily progress reports.'}
                </p>
                <button type="button" className="settings-btn btn-primary" onClick={handleConnectGithub} style={{ marginTop: '16px' }}>
                  {isZh ? '立即连接 GitHub' : 'Connect GitHub Now'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
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
