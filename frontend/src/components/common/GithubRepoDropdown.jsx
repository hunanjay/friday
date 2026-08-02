import React, { useState, useMemo } from 'react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { ChevronLeft, Github, Search, X } from './Icons';

function RepoSection({ label, repos, checked, onToggle }) {
  if (repos.length === 0) return null;
  return (
    <>
      <div className="repo-section-label">{label}</div>
      <div className="repo-picker-list">
        {repos.map(r => {
          const isChecked = checked.has(r.full_name);
          return (
            <label key={r.full_name} className={`repo-picker-item ${isChecked ? 'is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(r.full_name)}
                className="visually-hidden"
              />
              <span className="custom-checkbox" aria-hidden="true" />
              <span className="repo-icon-wrap">
                {r.private ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" title="Private repo">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" title="Public repo">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                    <path d="M2 12h20" />
                  </svg>
                )}
              </span>
              <span className="repo-picker-name" title={r.full_name}>{r.full_name}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}

export default function GithubRepoDropdown({ onBack }) {
  const {
    githubStatus,
    githubRepos,
    handleConnectGithub,
    handleDisconnectGithub,
    handleSaveGithubRepos,
    showToast,
  } = useWorkspace();

  const [checked, setChecked] = useState(() => new Set(githubRepos.selected));
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
      showToast('GitHub repos updated');
      onBack();
    } catch {
      showToast('Failed to save repo selection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    await handleDisconnectGithub();
    showToast('GitHub disconnected');
    onBack();
  };

  // Filter and group repos
  const filteredRepos = useMemo(() => {
    if (!githubRepos.available) return [];
    return githubRepos.available.filter(r =>
      r.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [githubRepos.available, searchQuery]);

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

  return (
    <div className="github-dropdown-container">
      <button className="theme-toggle-btn back-btn" onClick={onBack} style={{ marginBottom: '8px' }}>
        <ChevronLeft size={16} />
        <span>Back</span>
      </button>

      {githubStatus?.connected && (
        <div className="github-account-profile">
          {githubStatus.avatar_url ? (
            <img src={githubStatus.avatar_url} alt={githubStatus.login} className="github-avatar-img" />
          ) : (
            <div className="github-avatar-fallback">
              <Github size={16} />
            </div>
          )}
          <div className="github-account-info">
            <span className="github-account-name">{githubStatus.name || githubStatus.login}</span>
            <span className="github-account-login">@{githubStatus.login}</span>
          </div>
          <div className="github-status-badge">Connected</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button type="button" className="cancel-btn" onClick={handleConnectGithub} title="Refresh permissions/scope" style={{ flex: 1, padding: '6px 12px', fontSize: '0.8rem' }}>
          Reconnect
        </button>
        <button type="button" className="delete-event-btn" onClick={handleDisconnect} disabled={isDisconnecting} style={{ flex: 1, padding: '6px 12px', fontSize: '0.8rem' }}>
          {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>

      <div className="repo-search-container">
        <Search size={14} className="repo-search-icon" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter repositories..."
          className="repo-search-input"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="repo-search-clear" type="button">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="repo-picker-heading">
        <label>Selected repositories</label>
        <p>{checked.size} selected</p>
      </div>

      {filteredRepos.length > 0 && (
        <div className="repo-picker-actions">
          <button type="button" onClick={handleSelectAllFiltered} className="action-link-btn">Select matching</button>
          <span className="action-separator">•</span>
          <button type="button" onClick={handleClearAllFiltered} className="action-link-btn">Clear matching</button>
        </div>
      )}

      <div className="repo-picker-scroll">
        {githubRepos.available.length === 0 ? (
          <p className="repo-picker-empty">No repos found on your GitHub account.</p>
        ) : filteredRepos.length === 0 ? (
          <p className="repo-picker-empty">No repositories match your search.</p>
        ) : (
          <>
            <RepoSection label="Private" repos={privateRepos} checked={checked} onToggle={toggleRepo} />
            <RepoSection label="Public" repos={publicRepos} checked={checked} onToggle={toggleRepo} />
          </>
        )}
      </div>

      <button type="button" className="save-btn" onClick={handleSave} disabled={isSaving} style={{ width: '100%', marginTop: '4px' }}>
        {isSaving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
