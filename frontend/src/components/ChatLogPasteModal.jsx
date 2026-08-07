import React, { useState } from 'react';
import { X, Sparkles, CheckCircle, UserCheck } from './common/Icons';

export default function ChatLogPasteModal({ isOpen, onClose, authToken, API_URL, onExtractSuccess, isZh }) {
  const [text, setText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleExtract = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;

    setIsExtracting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_URL}/api/contacts/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ text: text.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data);
        if (onExtractSuccess) {
          onExtractSuccess(data.contact);
        }
      } else {
        const err = await res.json();
        setError(err.detail || (isZh ? '提取失败，请重试' : 'Extraction failed'));
      }
    } catch (err) {
      console.error('Extraction error:', err);
      setError(isZh ? '网络请求错误' : 'Network request failed');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleReset = () => {
    setText('');
    setResult(null);
    setError(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="create-contact-modal paste-extract-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={20} style={{ color: 'var(--accent-primary, #6366f1)' }} />
            <h4>{isZh ? '聊天记录 / 随手记 AI 提取' : 'Chat Log / Note AI Extract'}</h4>
          </div>
          <button type="button" className="close-modal-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {!result ? (
          <form onSubmit={handleExtract} className="modal-form">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              {isZh
                ? '粘贴与联系人的微信聊天记录、会议记录或非结构化随手记，AI 将自动识别联系人信息、4 大维度事实偏好与标签，并归档至关系大脑。'
                : 'Paste chat history or unstructured notes. AI will extract contact profile, 4-dimension facts & tags into your relationship brain.'}
            </p>

            <div className="form-group">
              <textarea
                rows={8}
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-light, #e2e8f0)',
                  backgroundColor: 'var(--bg-input, #f8fafc)',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  resize: 'vertical',
                }}
                placeholder={
                  isZh
                    ? '示例：今天和投资人张总聊了下，他目前在看医疗和AI领域，公司是华创资本。他平时特别喜欢喝普洱茶，计划下个月初来北京出差...'
                    : 'e.g. Spoke with Zhang from Huachuang Capital. He covers Healthcare and AI, likes Pu\'er tea, visiting Beijing next month...'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>

            {error && (
              <div style={{ color: 'var(--accent-danger, #ef4444)', fontSize: '0.85rem', marginBottom: 12 }}>
                {error}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="modal-cancel-btn" onClick={onClose} disabled={isExtracting}>
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button type="submit" className="modal-submit-btn" disabled={isExtracting || !text.trim()}>
                {isExtracting ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                    {isZh ? 'AI 正在分析提炼中...' : 'AI Extracting...'}
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={16} />
                    {isZh ? '开始 AI 智能提炼' : 'Start Extraction'}
                  </span>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="extract-result-container" style={{ padding: '16px 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#10b981',
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              <CheckCircle size={20} />
              <span>{isZh ? '成功提炼并归档至关系大脑！' : 'Successfully Extracted & Archived!'}</span>
            </div>

            <div
              style={{
                background: 'var(--bg-secondary, #f8fafc)',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <UserCheck size={18} />
                <strong style={{ fontSize: '1rem' }}>{result.contact?.name}</strong>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {[result.contact?.jobTitle, result.contact?.company].filter(Boolean).join(' @ ')}
                </span>
              </div>

              {result.contact?.ai_summary && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                  {result.contact.ai_summary}
                </p>
              )}

              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
                {isZh ? `提取事实表记录 (${result.extracted_profiles?.length || 0} 条):` : 'Extracted Facts:'}
              </div>
              <ul style={{ paddingLeft: 20, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                {result.extracted_profiles?.map((p, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>[{p.dimension} / {p.category}]</span> {p.fact_key}: {p.fact_value}
                  </li>
                ))}
              </ul>
            </div>

            <div className="modal-actions">
              <button type="button" className="modal-cancel-btn" onClick={handleReset}>
                {isZh ? '继续粘贴提取' : 'Extract Another'}
              </button>
              <button type="button" className="modal-submit-btn" onClick={onClose}>
                {isZh ? '查看联系人卡片' : 'View Contact Card'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
