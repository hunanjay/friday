import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Globe, Info, Mail, MicrosoftIcon, Moon, Sun } from '../components/common/Icons';
import BindMailAccountModal from '../components/BindMailAccountModal';
import { supabase } from '../supabaseClient';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showBindMail, setShowBindMail] = useState(false);
  const { user, authToken } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleOtherMail = () => {
    // Mail binding needs an authenticated Supabase session. If the user isn't
    // signed in yet, guide them to the Microsoft flow first (the Supabase
    // email/password provider can be enabled later by the maintainer).
    if (!user || !authToken) {
      setError(i18n.language === 'zh'
        ? '请先完成账号登录，再绑定其他邮箱。'
        : 'Please sign in first, then bind your mail account.');
      return;
    }
    setShowBindMail(true);
  };

  const handleAzureLogin = async () => {
    setError('');
    setIsSigningIn(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: window.location.origin,
          scopes: 'openid email profile offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite Contacts.ReadWrite',
        },
      });

      if (signInError) {
        setError(signInError.message);
        setIsSigningIn(false);
      }
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : t('login.genericError'));
      setIsSigningIn(false);
    }
  };

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(nextLang);
    localStorage.setItem('language', nextLang);
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-hero-title">
        <div className="login-brand-lockup">
          <span>Dora</span>
        </div>

        <div className="login-story-copy">
          <h1 id="login-hero-title">{t('login.heroTitle')}</h1>
          <p>{t('login.heroSub')}</p>
        </div>

        <div className="login-portrait" aria-hidden="true">
          <div className="login-portrait-backdrop" />
          <div className="login-portrait-shadow" />
          <img src="/dora_assistant_avatar.png" alt="" />
        </div>

        <p className="login-story-note">{t('login.storyNote')}</p>
      </section>

      <section className="login-access" aria-labelledby="login-title">
        <div className="login-mobile-brand" aria-hidden="true">
          <span>Dora</span>
        </div>

        <div className="login-controls" aria-label={t('login.displayControls')}>
          <a
            href="https://github.com/hunanjay/friday"
            target="_blank"
            rel="noreferrer"
            className="login-control"
            aria-label={t('login.githubLabel')}
            title="GitHub Repository"
          >
            <Github size={16} />
            <span>GitHub</span>
          </a>

          <button
            type="button"
            className="login-control"
            onClick={toggleLanguage}
            aria-label={i18n.language === 'en' ? '切换为中文' : 'Switch to English'}
          >
            <Globe size={16} />
            <span>{i18n.language === 'en' ? '中文' : 'EN'}</span>
          </button>

          <button
            type="button"
            className="login-control login-control-icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('login.lightMode') : t('login.darkMode')}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>

        <div className="login-panel">
          <header className="login-panel-header">
            <h2 id="login-title">{t('login.title')}</h2>
            <p>{t('login.subtitle')}</p>
          </header>

          <div className="login-auth-content">
            {error && (
              <div className="login-error" role="alert" aria-live="polite">
                <Info size={17} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleAzureLogin}
              className="login-microsoft-button"
              disabled={isSigningIn}
              aria-busy={isSigningIn}
            >
              <MicrosoftIcon size={19} />
              <span>{isSigningIn ? t('login.buttonLoading') : t('login.button')}</span>
              <span className="login-button-arrow" aria-hidden="true">→</span>
            </button>

            <div className="login-divider">
              <span>{i18n.language === 'zh' ? '或' : 'or'}</span>
            </div>

            <button
              type="button"
              onClick={handleOtherMail}
              className="login-other-mail-button"
            >
              <Mail size={18} />
              <span>{i18n.language === 'zh' ? '绑定其他邮箱（163 / QQ / Gmail 等）' : 'Bind another mailbox (163 / QQ / Gmail...)'}</span>
            </button>
          </div>
        </div>
      </section>

      <BindMailAccountModal
        isOpen={showBindMail}
        onClose={() => setShowBindMail(false)}
        authToken={authToken}
        isZh={i18n.language === 'zh'}
      />
    </main>
  );
}
