import React, { useEffect, useState } from 'react';
import { X, Mail, Sparkles } from './common/Icons';

const API_URL = import.meta.env.VITE_API_URL || '';

// 绑定邮箱弹窗：选择提供商 → 填账号+授权码 → （自定义时填服务器）→ 验证绑定。
// 通用 IMAP/SMTP 方案：163/QQ/Gmail/iCloud/Outlook 走预设服务器，
// "自定义"允许手填 IMAP/SMTP 地址（后端会做 SSRF 校验）。
export default function BindMailAccountModal({ isOpen, onClose, authToken, onBound, isZh }) {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('netease');
  const [emailAddress, setEmailAddress] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [username, setUsername] = useState('');
  // 自定义服务器字段
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecurity, setImapSecurity] = useState('ssl');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecurity, setSmtpSecurity] = useState('ssl');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setAuthCode('');
    fetch(`${API_URL}/api/mail-providers`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { providers: [] }))
      .then(data => {
        const list = data.providers || [];
        setProviders(list);
        if (list.length > 0 && !list.some(p => p.provider === provider)) {
          setProvider(list[0].provider);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, authToken]);

  if (!isOpen) return null;

  const isCustom = provider === 'custom';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const body = {
        provider,
        email_address: emailAddress.trim(),
        auth_code: authCode.trim(),
      };
      if (username.trim()) body.username = username.trim();
      if (isCustom) {
        body.imap_host = imapHost.trim();
        body.imap_port = parseInt(imapPort, 10);
        body.imap_security = imapSecurity;
        body.smtp_host = smtpHost.trim();
        body.smtp_port = parseInt(smtpPort, 10);
        body.smtp_security = smtpSecurity;
      }
      const res = await fetch(`${API_URL}/api/mail-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || (isZh ? '绑定失败' : 'Failed to bind'));
      if (onBound) onBound(data.account);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="create-contact-modal paste-extract-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={20} style={{ color: 'var(--accent-primary, #6366f1)' }} />
            <h4>{isZh ? '绑定邮箱账号' : 'Bind Mail Account'}</h4>
          </div>
          <button type="button" className="close-modal-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            {isZh
              ? '选择邮箱类型，填写账号和 IMAP/SMTP 授权码（在邮箱设置中开启 IMAP/SMTP 服务后生成）。凭据将加密存储。'
              : 'Pick your mail provider, enter the account and its IMAP/SMTP auth code (generated after enabling IMAP/SMTP in the mailbox settings). Credentials are stored encrypted.'}
          </p>

          <div className="form-group">
            <label>{isZh ? '邮箱类型' : 'Provider'}</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
              {providers.map(p => (
                <option key={p.provider} value={p.provider}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{isZh ? '邮箱地址' : 'Email address'}</label>
            <input
              type="email"
              required
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder="you@163.com"
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="form-group">
            <label>{isZh ? '授权码 (IMAP/SMTP)' : 'Auth code (IMAP/SMTP)'}</label>
            <input
              type="password"
              required
              autoComplete="off"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              placeholder={isZh ? '邮箱设置中生成的 16 位授权码' : '16-char auth code from mail settings'}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="form-group">
            <label>{isZh ? '登录用户名（可选，默认与邮箱一致）' : 'Username (optional, defaults to email)'}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isZh ? '部分邮箱登录名与地址不同' : 'Some providers use a separate login name'}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
            />
          </div>

          {isCustom && (
            <>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 4 }}>
                {isZh ? 'IMAP 服务器' : 'IMAP server'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" required value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }} />
                <input type="number" required value={imapPort} onChange={(e) => setImapPort(e.target.value)} style={{ width: 80, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }} />
                <select value={imapSecurity} onChange={(e) => setImapSecurity(e.target.value)} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
                  <option value="ssl">SSL</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 4 }}>
                {isZh ? 'SMTP 服务器' : 'SMTP server'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" required value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }} />
                <input type="number" required value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} style={{ width: 80, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }} />
                <select value={smtpSecurity} onChange={(e) => setSmtpSecurity(e.target.value)} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
                  <option value="ssl">SSL</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
            </>
          )}

          {error && (
            <div style={{ color: 'var(--accent-danger, #ef4444)', fontSize: '0.85rem', marginBottom: 12 }}>
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="modal-cancel-btn" onClick={onClose} disabled={isSubmitting}>
              {isZh ? '取消' : 'Cancel'}
            </button>
            <button type="submit" className="modal-submit-btn" disabled={isSubmitting || !emailAddress.trim() || !authCode.trim()}>
              {isSubmitting ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  {isZh ? '正在验证连接...' : 'Verifying...'}
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={16} />
                  {isZh ? '验证并绑定' : 'Verify & Bind'}
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
