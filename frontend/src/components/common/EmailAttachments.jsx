import React, { useState, useEffect, useRef } from 'react';
import { Paperclip, Download } from './Icons';

const API_URL = import.meta.env.VITE_API_URL || '';
const PREFETCH_MAX_BYTES = 1024 * 1024;
const attachmentRequests = new Map();
const attachmentDownloadRequests = new Map();

// 附件接口按 provider 路由：微软走 /api/graph/mail/{id}/attachments，
// IMAP 账号走 /api/mail/{id}/attachments（email_id 自带 account_id）。
const attachmentBase = (messageId, provider) =>
  provider === 'imap'
    ? `${API_URL}/api/mail/${encodeURIComponent(messageId)}/attachments`
    : `${API_URL}/api/graph/mail/${encodeURIComponent(messageId)}/attachments`;

const loadAttachments = (messageId, provider, authToken) => {
  const existingRequest = attachmentRequests.get(messageId);
  if (existingRequest) return existingRequest;

  const request = fetch(`${attachmentBase(messageId, provider)}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  })
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load attachments (${res.status})`);
      return res.json();
    })
    .finally(() => attachmentRequests.delete(messageId));

  attachmentRequests.set(messageId, request);
  return request;
};

const loadAttachmentBlob = (messageId, attachmentId, provider, authToken) => {
  const requestKey = `${messageId}:${attachmentId}`;
  const existingRequest = attachmentDownloadRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = fetch(
    `${attachmentBase(messageId, provider)}/${encodeURIComponent(attachmentId)}/download`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  )
    .then(res => {
      if (!res.ok) throw new Error(`Failed to download attachment (${res.status})`);
      return res.blob();
    })
    .finally(() => attachmentDownloadRequests.delete(requestKey));

  attachmentDownloadRequests.set(requestKey, request);
  return request;
};

const EmailAttachments = ({ messageId, hasAttachments, authToken, initialAttachments, provider }) => {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const prefetchedBlobsRef = useRef(new Map());

  useEffect(() => {
    if (!hasAttachments || !messageId) return;

    let active = true;
    const applyAttachments = (values) => {
      if (!active) return;
      const downloadableAttachments = values.filter(attachment => !attachment.isInline);
      setAttachments(downloadableAttachments);
    };

    if (Array.isArray(initialAttachments)) {
      applyAttachments(initialAttachments);
      setLoading(false);
    } else {
      setLoading(true);
      loadAttachments(messageId, provider, authToken)
        .then(data => applyAttachments(data.value || []))
        .catch(console.error)
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [messageId, hasAttachments, authToken, initialAttachments, provider]);

  if (!hasAttachments) return null;

  const prefetchAttachment = (attachment) => {
    if (
      attachment.size > PREFETCH_MAX_BYTES
      || prefetchedBlobsRef.current.has(attachment.id)
    ) return;

    loadAttachmentBlob(messageId, attachment.id, provider, authToken)
      .then(blob => prefetchedBlobsRef.current.set(attachment.id, blob))
      .catch(() => {
        // Prefetch is opportunistic; clicking retries if it failed.
      });
  };

  const handleDownload = async (attachment) => {
    try {
      const blob = prefetchedBlobsRef.current.get(attachment.id)
        || await loadAttachmentBlob(messageId, attachment.id, provider, authToken);
      prefetchedBlobsRef.current.set(attachment.id, blob);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.error(err);
      alert('Download failed');
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (loading) {
    return <div className="attachments-list-loading" style={{ padding: '12px 16px', color: '#666', fontSize: '0.9rem' }}>Loading attachments...</div>;
  }

  if (attachments.length === 0) return null;

  return (
    <div className="email-attachments-section" style={{ borderTop: '1px solid var(--border-light)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
        <Paperclip size={16} />
        {attachments.length} Attachments
      </div>
      <div className="attachments-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {attachments.map(att => (
          <div
            key={att.id}
            className="attachment-card"
            role="button"
            tabIndex={0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 12px',
              border: '1px solid var(--border-light)',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-card)',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              minWidth: '200px',
              maxWidth: '300px'
            }}
            onClick={() => handleDownload(att)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleDownload(att);
              }
            }}
            onMouseEnter={() => prefetchAttachment(att)}
            onFocus={() => prefetchAttachment(att)}
            onPointerDown={() => prefetchAttachment(att)}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-card)'}
          >
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={att.name}>
                {att.name}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                {formatSize(att.size)}
              </div>
            </div>
            <Download size={16} color="var(--text-secondary)" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default EmailAttachments;
