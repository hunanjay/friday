import React from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Trash } from './Icons';

/**
 * Reusable Approval Card component for AI-generated actions & drafts.
 * Used in both ChatPage (HitL Action Approvals) and EmailPage (Dora Assistant Drafts).
 */
export default function ApprovalCard({
  action,
  title,
  subtitle,
  statusLabel,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  customActions,
  className = '',
}) {
  const { t } = useTranslation();

  if (!action || !action.payload) return null;

  const isResolved = action.resolved;
  const isSendEmail = action.action_type === 'send_email' || !action.action_type;
  const isDeleteEmail = action.action_type === 'delete_email';

  const defaultTitle = title || (isSendEmail ? t('chat.reviewEmail') : t('chat.reviewDelete'));
  const defaultSubtitle = subtitle || t('chat.approvalRequired');
  const defaultStatusLabel = statusLabel || (isResolved ? t('chat.approvalStatusSent') : t('chat.approvalStatusPending'));

  if (isResolved) {
    return (
      <div className={`approval-card approval-card-resolved ${className}`} role="status">
        <div className="approval-resolved-status">
          <span className="approval-status approval-status-sent">
            {defaultStatusLabel}
          </span>
        </div>
        {isSendEmail ? (
          <div className="approval-email-preview">
            {action.payload.to && (
              <div className="approval-email-recipient">
                <span>{t('email.to')}</span>
                <strong>{action.payload.to}</strong>
              </div>
            )}
            {action.payload.subject && (
              <h4 className="approval-email-subject">{action.payload.subject}</h4>
            )}
            {action.payload.body && (
              <div className="approval-email-body">
                <span>{t('email.body')}</span>
                <p>{action.payload.body}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="approval-details">
            {action.payload.subject && (
              <div>
                <span>{t('email.subject')}</span>
                <strong>{action.payload.subject}</strong>
              </div>
            )}
            {action.payload.sender && (
              <div>
                <span>{t('chat.sender')}</span>
                <strong>{action.payload.sender}</strong>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`approval-card ${className}`} role="group" aria-label={defaultTitle}>
      <div className="approval-card-header">
        <span className="approval-card-icon">
          {isSendEmail ? <Mail size={18} /> : <Trash size={18} />}
        </span>
        <div>
          <div className="approval-title-row">
            <strong>{defaultTitle}</strong>
            <span className={`approval-status ${statusLabel ? 'approval-status-pending' : 'approval-status-pending'}`}>
              {defaultStatusLabel}
            </span>
          </div>
          <p>{defaultSubtitle}</p>
        </div>
      </div>

      {isSendEmail ? (
        <div className="approval-email-preview">
          {action.payload.to && (
            <div className="approval-email-recipient">
              <span>{t('email.to')}</span>
              <strong>{action.payload.to}</strong>
            </div>
          )}
          {action.payload.subject && (
            <h4 className="approval-email-subject">{action.payload.subject}</h4>
          )}
          {action.payload.body && (
            <div className="approval-email-body">
              <span>{t('email.body')}</span>
              <p>{action.payload.body}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="approval-details">
          {action.payload.subject && (
            <div>
              <span>{t('email.subject')}</span>
              <strong>{action.payload.subject}</strong>
            </div>
          )}
          {action.payload.sender && (
            <div>
              <span>{t('chat.sender')}</span>
              <strong>{action.payload.sender}</strong>
            </div>
          )}
        </div>
      )}

      {action.error && <p className="approval-error" role="alert">{action.error}</p>}

      <div className="approval-actions">
        {customActions ? (
          customActions
        ) : (
          <>
            {onCancel && (
              <button
                type="button"
                className="approval-cancel-btn"
                disabled={action.busy}
                onClick={onCancel}
              >
                {cancelText || t('common.cancel')}
              </button>
            )}
            {onConfirm && (
              <button
                type="button"
                className="approval-confirm-btn"
                disabled={action.busy}
                onClick={onConfirm}
              >
                {action.busy
                  ? t('chat.approvalWorking')
                  : confirmText || (isSendEmail ? t('chat.confirmSend') : t('chat.confirmDelete'))}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
