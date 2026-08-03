import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Globe, Info, MicrosoftIcon, Moon, Sun } from '../components/common/Icons';
import { supabase } from '../supabaseClient';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { user } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

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
          </div>
        </div>
      </section>
    </main>
  );
}
