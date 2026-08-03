import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { Mail, Calendar, MessageSquare, Edit3, Users, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen } from '../common/Icons';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { Grid24Regular } from '@fluentui/react-icons';

export default function MainLayout() {
  const {
    user,
    emails,
    inboxUnread,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    handleLogout,
    toast,
    isSyncingInbox,
    isSyncingEvents,
  } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  // Redirect to login if not logged in
  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  // Close the settings popover on an outside click, resetting back to the
  // main view so it doesn't reopen mid-drill-down next time.
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

  if (!user) return null;

  const unreadEmailsCount = inboxUnread ?? emails.filter(e => e.parentFolderId === 'inbox' && !e.isRead).length;
  const activeTab = location.pathname.split('/')[1] || 'email';
  const isSyncing = isSyncingInbox || isSyncingEvents;

  return (
    <div className={"app-workspace " + (isSidebarCollapsed ? "sidebar-collapsed" : "")}>
      {isSyncing && (
        <div className="sync-marquee">
          <div className="sync-marquee-track" />
        </div>
      )}
      {/* Sidebar Navigation */}
      <aside className={"app-sidebar " + (isSidebarCollapsed ? "collapsed" : "")}>
        <div className="sidebar-brand">
          {!isSidebarCollapsed && (
            <img
              src="/dora_assistant_avatar.png"
              alt="Dora Logo"
              style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          {!isSidebarCollapsed && <h2>{t('common.appName')}</h2>}
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

      {/* Global Animated Toast Notification */}
      {toast.visible && (
        <div className="global-toast-notification">
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
