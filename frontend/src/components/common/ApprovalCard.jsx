import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApprovalRenderer } from './ApprovalPreview';

/**
 * Generic human-in-the-loop approval shell. The backend selects the preview,
 * placement, and allowed decisions; renderer components only display trusted
 * structured payloads and never decide what can be executed.
 */
export default function ApprovalCard({
  action,
  title,
  subtitle,
  statusLabel,
  onDecision,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  customActions,
  className = '',
  assistantName = 'Friday',
}) {
  const { t } = useTranslation();
  // Inline edits to the draft, applied to the tool call on approval.
  const [edits, setEdits] = useState({});

  if (!action || !action.payload) return null;

  const presentation = action.presentation || {};
  const { Preview, Icon } = getApprovalRenderer(action);
  const actionStatus = action.status || 'pending';
  const isResolved = action.resolved || actionStatus !== 'pending';
  const defaultTitle = title || (presentation.title_key
    ? t(presentation.title_key)
    : t('chat.reviewAction'));
  const defaultSubtitle = subtitle
    || t(presentation.subtitle_key || 'chat.approvalRequired', { name: assistantName });
  const terminalStatusKeys = {
    cancelled: 'chat.approvalStatusCancelled',
    expired: 'chat.approvalStatusExpired',
    failed: 'chat.approvalStatusFailed',
    executing: 'chat.approvalStatusExecuting',
  };
  const statusKey = terminalStatusKeys[actionStatus] || (isResolved
    ? presentation.completed_status_key || 'chat.approvalStatusCompleted'
    : presentation.pending_status_key || 'chat.approvalStatusPending');
  const defaultStatusLabel = statusLabel || t(statusKey);
  const configuredDecisions = action.decisions || [];

  const renderActions = () => {
    if (customActions) return customActions;
    if (configuredDecisions.length && onDecision) {
      return configuredDecisions.map((decision) => (
        <button
          key={decision.id}
          type="button"
          className={decision.style === 'secondary'
            ? 'approval-cancel-btn'
            : `approval-confirm-btn ${decision.style === 'danger' ? 'approval-danger-btn' : ''}`}
          disabled={action.busy}
          onClick={() => onDecision(decision.id, edits)}
        >
          {action.busy ? t('chat.approvalWorking') : t(decision.label_key)}
        </button>
      ));
    }
    return (
      <>
        {onCancel && (
          <button type="button" className="approval-cancel-btn" disabled={action.busy} onClick={onCancel}>
            {cancelText || t('common.cancel')}
          </button>
        )}
        {onConfirm && (
          <button type="button" className="approval-confirm-btn" disabled={action.busy} onClick={onConfirm}>
            {action.busy ? t('chat.approvalWorking') : confirmText || t('common.confirm')}
          </button>
        )}
      </>
    );
  };

  if (isResolved) {
    return (
      <div className={`approval-card approval-card-resolved approval-card-${actionStatus} ${className}`} role="status">
        <div className="approval-resolved-status">
          <span className={`approval-status approval-status-${actionStatus}`}>{defaultStatusLabel}</span>
        </div>
        <Preview payload={action.payload} action={action} t={t} />
        {action.error && <p className="approval-error" role="alert">{action.error}</p>}
      </div>
    );
  }

  return (
    <div className={`approval-card ${className}`} role="group" aria-label={defaultTitle}>
      <div className="approval-card-header">
        <span className="approval-card-icon"><Icon size={15} /></span>
        <div>
          <div className="approval-title-row">
            <strong>{defaultTitle}</strong>
            <span className="approval-status approval-status-pending">{defaultStatusLabel}</span>
          </div>
          <p>{defaultSubtitle}</p>
        </div>
      </div>

      <Preview
        payload={action.payload}
        action={action}
        t={t}
        onEdit={presentation.editable
          ? (field, value) => setEdits(prev => ({ ...prev, [field]: value }))
          : undefined}
      />
      {action.error && <p className="approval-error" role="alert">{action.error}</p>}
      <div className="approval-actions">{renderActions()}</div>
    </div>
  );
}
