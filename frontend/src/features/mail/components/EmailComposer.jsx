import React from 'react';
import { Plus, Send, X } from '../../../components/common/Icons';
import { MICROSOFT_MAIL_CHANNEL } from '../mailboxApi';

export function EmailComposer({
  compose,
  isZh,
  mailAccounts,
  signature,
  t,
}) {
  if (!compose.isComposing) return null;

  const handleAttachmentChange = event => {
    compose.addAttachments(
      event.target.files,
      values => t('email.attachmentsTooLarge', values),
    );
    event.target.value = '';
  };

  return (
    <div className="compose-modal-overlay">
      <div className="compose-modal">
        <div className="compose-modal-header">
          <h3>{isZh ? '新建邮件' : 'New Message'}</h3>
          <button
            type="button"
            aria-label={isZh ? '关闭写信窗口' : 'Close composer'}
            className="close-compose"
            onClick={compose.closeCompose}
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={compose.submitCompose} className="compose-form">
          <div className="compose-input-group">
            <label htmlFor="compose-provider">{isZh ? '发送账户' : 'Send from'}:</label>
            <select
              id="compose-provider"
              value={compose.composeChannel}
              onChange={event => compose.setComposeChannel(event.target.value)}
              style={{ flex: 1, padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
            >
              <option value={MICROSOFT_MAIL_CHANNEL}>
                {isZh ? '微软邮箱 (Outlook)' : 'Microsoft (Outlook)'}
              </option>
              {(mailAccounts || []).map(account => (
                <option key={account.id} value={account.id}>{account.email_address}</option>
              ))}
            </select>
          </div>
          <div className="compose-input-group">
            <label htmlFor="compose-to">{t('email.to')}:</label>
            <input
              type="text"
              id="compose-to"
              value={compose.composeTo}
              onChange={event => compose.setComposeTo(event.target.value)}
              placeholder="recipients@email.com"
              required
            />
            {!compose.showCopyFields && (
              <button
                type="button"
                className="compose-copy-toggle"
                onClick={() => compose.setShowCopyFields(true)}
              >
                {t('email.cc')} / {t('email.bcc')}
              </button>
            )}
          </div>
          {compose.showCopyFields && (
            <>
              <div className="compose-input-group">
                <label htmlFor="compose-cc">{t('email.cc')}:</label>
                <input
                  type="text"
                  id="compose-cc"
                  value={compose.composeCc}
                  onChange={event => compose.setComposeCc(event.target.value)}
                  placeholder="a@example.com, b@example.com"
                />
              </div>
              <div className="compose-input-group">
                <label htmlFor="compose-bcc">{t('email.bcc')}:</label>
                <input
                  type="text"
                  id="compose-bcc"
                  value={compose.composeBcc}
                  onChange={event => compose.setComposeBcc(event.target.value)}
                  placeholder="a@example.com, b@example.com"
                />
              </div>
            </>
          )}
          <div className="compose-input-group">
            <label htmlFor="compose-subject">{t('email.subject')}:</label>
            <input
              type="text"
              id="compose-subject"
              value={compose.composeSubject}
              onChange={event => compose.setComposeSubject(event.target.value)}
              placeholder="Conversation topic"
              required
            />
          </div>
          <div className="compose-body-group">
            <textarea
              id="compose-body"
              value={compose.composeBody}
              onChange={event => compose.setComposeBody(event.target.value)}
              placeholder="Write your email here..."
              required
            />
            {signature && (
              <div className="compose-signature-preview">
                <span>{t('email.signature')}</span>
                <p>{signature}</p>
              </div>
            )}
          </div>
          <div className="compose-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="compose-attachments-list" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
              <label className="attachment-upload-btn" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '0.85rem', border: '1px solid var(--border-light)' }}>
                <Plus size={14} style={{ marginRight: '4px' }} /> {isZh ? '添加附件' : 'Add'}
                <input
                  aria-label={isZh ? '添加附件' : 'Add attachment'}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleAttachmentChange}
                />
              </label>
              {compose.composeAttachments.map((attachment, index) => (
                <div key={`${attachment.name}-${attachment.lastModified}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', backgroundColor: 'var(--bg-hover)', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid var(--border-light)' }}>
                  <span style={{ maxWidth: '100px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={attachment.name}>
                    {attachment.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`${isZh ? '移除' : 'Remove'} ${attachment.name}`}
                    onClick={() => compose.removeAttachment(index)}
                    style={{ display: 'contents', color: 'var(--text-tertiary)' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button type="submit" className="send-btn" disabled={compose.isSending}>
              <Send size={16} />
              <span>{compose.isSending ? `${t('email.send')}...` : t('email.send')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
