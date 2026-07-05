import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from './Icons';

export default function LanguageSwitcher({ isSidebarCollapsed }) {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(nextLang);
    localStorage.setItem('language', nextLang);
  };

  return (
    <button 
      className="language-toggle-btn" 
      onClick={toggleLanguage} 
      title={i18n.language === 'en' ? 'Switch to Chinese' : '切换为英文'}
    >
      <Globe size={18} />
      {!isSidebarCollapsed && <span>{i18n.language === 'en' ? '中文' : 'English'}</span>}
    </button>
  );
}
