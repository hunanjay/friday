import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from '../components/common/Icons';
import { supabase } from '../supabaseClient';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';

export default function LoginPage() {
  const [error, setError] = useState('');
  const { user } = useWorkspace();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Redirect to workspace if already logged in
  useEffect(() => {
    if (user) {
      navigate('/email');
    }
  }, [user, navigate]);

  const handleAzureLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: window.location.origin,
        scopes: 'openid email profile offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite',
      },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-avatar-wrapper">
            <img src="/dora_assistant_avatar.png" alt="Dora" className="login-avatar" />
            <div className="dora-pulse-glow"></div>
          </div>
          <h1>{t('login.title')}</h1>
          <p className="login-subtitle">{t('login.subtitle')}</p>
        </div>

        {error && (
          <div className="login-error-alert" role="alert">
            <Info size={16} className="error-icon" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleAzureLogin}
          className="login-submit-btn"
        >
          {t('login.button')}
        </button>

        <div className="login-footer">
          <p>{t('login.footer')}</p>
        </div>
      </div>
    </div>
  );
}
