import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useTheme } from '../../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { Mail, Calendar, MessageSquare, Edit3, LogOut, Sun, Moon, PanelLeftClose, PanelLeftOpen } from '../common/Icons';
import LanguageSwitcher from '../common/LanguageSwitcher';

export default function MainLayout() {
  const {
    user,
    emails,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    handleLogout,
    toast,
    isSyncingInbox,
    isSyncingEvents
  } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to login if not logged in
  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  if (!user) return null;

  const unreadEmailsCount = emails.filter(e => e.parentFolderId === 'inbox' && !e.isRead).length;
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
        </nav>

        <div className="sidebar-footer">
          <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Theme">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            {!isSidebarCollapsed && <span>{theme === 'light' ? t('common.themeDark') : t('common.themeLight')}</span>}
          </button>

          <LanguageSwitcher isSidebarCollapsed={isSidebarCollapsed} />

          <div className="user-profile-widget">
            <div className="user-avatar" title={isSidebarCollapsed ? `${user.name} (${user.email})` : ""}>
              {user.name ? user.name[0].toUpperCase() : 'U'}
            </div>
            {!isSidebarCollapsed && (
              <div className="user-info">
                <span className="user-name">{user.name}</span>
                <span className="user-email">{user.email}</span>
              </div>
            )}
            {!isSidebarCollapsed && (
              <button className="logout-btn" onClick={handleLogout} title={t('common.signOut')}>
                <LogOut size={16} />
              </button>
            )}
          </div>
          {isSidebarCollapsed && (
            <button className="logout-btn-collapsed" onClick={handleLogout} title={t('common.signOut')}>
              <LogOut size={16} />
            </button>
          )}
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
