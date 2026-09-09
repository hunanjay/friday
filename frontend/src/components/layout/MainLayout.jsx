import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../features/auth/useAuth';
import { useCalendarSyncStatus } from '../../features/calendar/hooks';
import { useInboxUnread, useMailMessages, useMailSyncStatus } from '../../features/mail/mailboxHooks';
import { useAssistantName, useAvatar } from '../../features/settings/hooks';
import { useTheme } from '../../hooks/useTheme';
import { useUi } from '../../hooks/useUi';
import { useTranslation } from 'react-i18next';
import { Mail, Calendar, MessageSquare, Edit3, Users, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen, X } from '../common/Icons';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { Grid24Regular } from '@fluentui/react-icons';

export default function MainLayout() {
  const { user, isAuthReady, handleLogout } = useAuth();
  const { isSidebarCollapsed, setIsSidebarCollapsed, toast } = useUi();
  const { assistantName } = useAssistantName();
  const { avatarUrl } = useAvatar();
  const isSyncingEvents = useCalendarSyncStatus();
  const { emails } = useMailMessages();
  const { inboxUnread } = useInboxUnread();
  const { isSyncingInbox } = useMailSyncStatus();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const settingsRef = useRef(null);
  const mobileSheetRef = useRef(null);

  // Redirect to login once the real auth check has resolved. Gating on
  // isAuthReady avoids bouncing to /login off the optimistic cached `user`
  // before AuthProvider's actual Supabase session check has run.
  useEffect(() => {
    if (isAuthReady && !user) {
      navigate('/login');
    }
  }, [isAuthReady, user, navigate]);

  // Close desktop settings popover on outside click
  useEffect(() => {
    if (!isSettingsOpen) return;
    const onClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isSettingsOpen]);

  // Close mobile settings sheet on outside click or route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onEsc = (e) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [isMobileMenuOpen]);

  if (!isAuthReady || !user) return null;

  const unreadEmailsCount = inboxUnread ?? emails.filter(e => e.parentFolderId === 'inbox' && !e.isRead).length;
  const activeTab = location.pathname.split('/')[1] || 'dashboard';
  const isSyncing = isSyncingInbox || isSyncingEvents;

  const getPageTitle = (tab) => {
    const isZh = i18n.language === 'zh';
    switch (tab) {
      case 'dashboard': return isZh ? '工作台概览' : 'Dashboard';
      case 'email': return t('common.email');
      case 'calendar': return t('common.calendar');
      case 'chat': return t('common.chat');
      case 'memos': return t('common.memos');
      case 'contacts': return t('common.contacts') || (isZh ? '联系人' : 'Contacts');
      case 'settings': return isZh ? '偏好设置' : 'Settings';
      default: return assistantName;
    }
  };

  return (
    <div className={"app-workspace " + (isSidebarCollapsed ? "sidebar-collapsed" : "")}>
      {isSyncing && (
        <div className="sync-marquee">
          <div className="sync-marquee-track" />
        </div>
      )}

      {/* Mobile Top App Header (Visible on <= 768px) */}
      <header className="mobile-top-header">
        <div className="mobile-header-brand">
          <img
            src={avatarUrl || '/dora_assistant_avatar.png'}
            alt={`${assistantName} Logo`}
            className="mobile-brand-avatar"
          />
          <div className="mobile-header-title-group">
            <span className="mobile-header-appname">{assistantName}</span>
            <span className="mobile-header-current-page">{getPageTitle(activeTab)}</span>
          </div>
        </div>

        <div className="mobile-header-actions">
          <button
            className="mobile-header-icon-btn"
            onClick={toggleTheme}
            title={theme === 'light' ? t('common.themeDark') : t('common.themeLight')}
            aria-label="Toggle Theme"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <button
            className="mobile-user-avatar-btn"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open User Menu"
            title={`${user.name} (${user.email})`}
          >
            {user.name ? user.name[0].toUpperCase() : 'U'}
          </button>
        </div>
      </header>

      {/* Desktop Sidebar Navigation (Visible on > 768px) */}
      <aside className={"app-sidebar " + (isSidebarCollapsed ? "collapsed" : "")}>
        <div className="sidebar-brand">
          {!isSidebarCollapsed && (
            <img
              src={avatarUrl || '/dora_assistant_avatar.png'}
              alt={`${assistantName} Logo`}
              style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          {!isSidebarCollapsed && <h2>{assistantName}</h2>}
          <button 
            className="sidebar-collapse-btn" 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          <Link
            to="/dashboard"
            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            title={isSidebarCollapsed ? (i18n.language === 'zh' ? '概览' : 'Dashboard') : ''}
          >
            <Grid24Regular className="sidebar-dashboard-icon" />
            {!isSidebarCollapsed && <span>{i18n.language === 'zh' ? '概览' : 'Dashboard'}</span>}
          </Link>
          <Link
            to="/email"
            className={`nav-link ${activeTab === 'email' ? 'active' : ''}`}
            title={isSidebarCollapsed ? t('common.email') : ""}
          >
            <Mail size={20} />
            {!isSidebarCollapsed && <span>{t('common.email')}</span>}
            {unreadEmailsCount > 0 && (
              <span className={"nav-badge " + (isSidebarCollapsed ? "collapsed-badge" : "")}>
                {unreadEmailsCount}
              </span>
            )}
          </Link>
          <Link 
            to="/calendar"
            className={`nav-link ${activeTab === 'calendar' ? 'active' : ''}`}
            title={isSidebarCollapsed ? t('common.calendar') : ""}
          >
            <Calendar size={20} />
            {!isSidebarCollapsed && <span>{t('common.calendar')}</span>}
          </Link>
          <Link 
            to="/chat"
            className={`nav-link ${activeTab === 'chat' ? 'active' : ''}`}
            title={isSidebarCollapsed ? t('common.chat') : ""}
          >
            <MessageSquare size={20} />
            {!isSidebarCollapsed && <span>{t('common.chat')}</span>}
          </Link>
          <Link 
            to="/memos"
            className={`nav-link ${activeTab === 'memos' ? 'active' : ''}`}
            title={isSidebarCollapsed ? t('common.memos') : ""}
          >
            <Edit3 size={20} />
            {!isSidebarCollapsed && <span>{t('common.memos')}</span>}
          </Link>
          <Link
            to="/contacts"
            className={`nav-link ${activeTab === 'contacts' ? 'active' : ''}`}
            title={isSidebarCollapsed ? (t('common.contacts') || '联系人') : ""}
          >
            <Users size={20} />
            {!isSidebarCollapsed && <span>{t('common.contacts') || '联系人'}</span>}
          </Link>
        </nav>

        <div className="sidebar-footer" ref={settingsRef}>
          <div className="user-profile-widget settings-trigger" onClick={() => setIsSettingsOpen(o => !o)}>
            <div className="user-avatar" title={isSidebarCollapsed ? `${user.name} (${user.email})` : ""}>
              {user.name ? user.name[0].toUpperCase() : 'U'}
            </div>
            {!isSidebarCollapsed && (
              <div className="user-info">
                <span className="user-name">{user.name}</span>
                <span className="user-email">{user.email}</span>
              </div>
            )}

            {isSettingsOpen && (
              <div
                className="settings-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button 
                  className="theme-toggle-btn" 
                  onClick={() => { navigate('/settings'); setIsSettingsOpen(false); }} 
                  title={i18n.language === 'zh' ? '偏好设置' : 'Preferences'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-settings">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span>{i18n.language === 'zh' ? '偏好设置' : 'Preferences'}</span>
                </button>

                <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Theme">
                  {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                  <span>{theme === 'light' ? t('common.themeDark') : t('common.themeLight')}</span>
                </button>

                <LanguageSwitcher isSidebarCollapsed={false} />

                <div className="settings-menu-divider" />

                <button className="theme-toggle-btn" onClick={handleLogout} title={t('common.signOut')}>
                  <LogOut size={18} />
                  <span>{t('common.signOut')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Screen Content */}
      <main className="app-main-content">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation Bar (Visible on <= 768px) */}
      <nav className="mobile-bottom-nav">
        <Link
          to="/dashboard"
          className={`mobile-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <div className="mobile-nav-icon-wrapper">
            <Grid24Regular className="mobile-nav-fluent-icon" />
          </div>
          <span className="mobile-nav-label">{i18n.language === 'zh' ? '概览' : 'Home'}</span>
        </Link>

        <Link
          to="/email"
          className={`mobile-nav-item ${activeTab === 'email' ? 'active' : ''}`}
        >
          <div className="mobile-nav-icon-wrapper">
            <Mail size={20} />
            {unreadEmailsCount > 0 && (
              <span className="mobile-nav-badge">
                {unreadEmailsCount > 99 ? '99+' : unreadEmailsCount}
              </span>
            )}
          </div>
          <span className="mobile-nav-label">{t('common.email')}</span>
        </Link>

        <Link
          to="/calendar"
          className={`mobile-nav-item ${activeTab === 'calendar' ? 'active' : ''}`}
        >
          <div className="mobile-nav-icon-wrapper">
            <Calendar size={20} />
          </div>
          <span className="mobile-nav-label">{t('common.calendar')}</span>
        </Link>

        <Link
          to="/chat"
          className={`mobile-nav-item ${activeTab === 'chat' ? 'active' : ''}`}
        >
          <div className="mobile-nav-icon-wrapper">
            <MessageSquare size={20} />
          </div>
          <span className="mobile-nav-label">{t('common.chat')}</span>
        </Link>

        <Link
          to="/memos"
          className={`mobile-nav-item ${activeTab === 'memos' ? 'active' : ''}`}
        >
          <div className="mobile-nav-icon-wrapper">
            <Edit3 size={20} />
          </div>
          <span className="mobile-nav-label">{t('common.memos')}</span>
        </Link>

        <Link
          to="/contacts"
          className={`mobile-nav-item ${activeTab === 'contacts' ? 'active' : ''}`}
        >
          <div className="mobile-nav-icon-wrapper">
            <Users size={20} />
          </div>
          <span className="mobile-nav-label">{t('common.contacts') || (i18n.language === 'zh' ? '人脉' : 'People')}</span>
        </Link>
      </nav>

      {/* Mobile Profile & Settings Modal Sheet */}
      {isMobileMenuOpen && (
        <div className="mobile-settings-overlay" onClick={() => setIsMobileMenuOpen(false)}>
          <div
            className="mobile-settings-sheet"
            ref={mobileSheetRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-sheet-handle" />
            
            <div className="mobile-sheet-header">
              <div className="mobile-sheet-user-info">
                <div className="mobile-sheet-avatar">
                  {user.name ? user.name[0].toUpperCase() : 'U'}
                </div>
                <div className="mobile-sheet-user-text">
                  <h4>{user.name || 'User'}</h4>
                  <p>{user.email}</p>
                </div>
              </div>
              <button
                className="mobile-sheet-close-btn"
                onClick={() => setIsMobileMenuOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mobile-sheet-menu-list">
              <button
                className="mobile-sheet-menu-item"
                onClick={() => {
                  navigate('/settings');
                  setIsMobileMenuOpen(false);
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <span>{i18n.language === 'zh' ? '偏好设置与集成' : 'Preferences & Integrations'}</span>
              </button>

              <button className="mobile-sheet-menu-item" onClick={toggleTheme}>
                {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                <span>{theme === 'light' ? t('common.themeDark') : t('common.themeLight')}</span>
              </button>

              <div className="mobile-sheet-language-row">
                <LanguageSwitcher isSidebarCollapsed={false} />
              </div>

              <div className="mobile-sheet-divider" />

              <button
                className="mobile-sheet-menu-item logout-item"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
              >
                <LogOut size={20} />
                <span>{t('common.signOut')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Animated Toast Notification */}
      {toast.visible && (
        <div className="global-toast-notification">
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
