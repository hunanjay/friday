import React from 'react';
import ApprovalCard from '../../../components/common/ApprovalCard';
import EmailAttachments from '../../../components/common/EmailAttachments';
import EmailContentRenderer from '../../../components/common/EmailContentRenderer';
import {
  ChevronLeft,
  Forward,
  Mail,
  Reply,
  ReplyAll,
  Sparkles,
  X,
} from '../../../components/common/Icons';

function formatEmailTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatEmailDateFull(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString(
    undefined,
    { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

function EmailDetailSkeleton({ showAssistant }) {
  return (
    <div
      className="email-reader-split-layout"
      aria-busy="true"
      aria-label="Loading email details"
      style={{ position: 'absolute', inset: 0, zIndex: 2, backgroundColor: 'var(--bg-card)' }}
    >
      <div className="email-detail-column" style={{ padding: '32px 40px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 16px', paddingBottom: '20px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ flex: '1 1 100%' }}>
            <div className="skeleton-box" style={{ width: '55%', height: '22px', borderRadius: '4px' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <div className="skeleton-box" style={{ width: '76px', height: '32px', borderRadius: '6px' }} />
            <div className="skeleton-box" style={{ width: '76px', height: '32px', borderRadius: '6px' }} />
            <div className="skeleton-box" style={{ width: '76px', height: '32px', borderRadius: '6px' }} />
            <div className="skeleton-box" style={{ width: '110px', height: '32px', borderRadius: '6px' }} />
          </div>
        </div>
        <div style={{ padding: '28px 0 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <div className="skeleton-box" style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0 }} />
            <div className="skeleton-box" style={{ width: '38%', height: '16px', borderRadius: '4px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="skeleton-box" style={{ width: '100%', height: '14px', borderRadius: '4px' }} />
            <div className="skeleton-box" style={{ width: '96%', height: '14px', borderRadius: '4px' }} />
            <div className="skeleton-box" style={{ width: '88%', height: '14px', borderRadius: '4px' }} />
            <div className="skeleton-box" style={{ width: '72%', height: '14px', borderRadius: '4px' }} />
            <div className="skeleton-box" style={{ width: '82%', height: '150px', margin: '10px 0', borderRadius: '8px' }} />
            <div className="skeleton-box" style={{ width: '94%', height: '14px', borderRadius: '4px' }} />
            <div className="skeleton-box" style={{ width: '62%', height: '14px', borderRadius: '4px' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '22px' }}>
          <div className="skeleton-box" style={{ width: '180px', height: '52px', borderRadius: '8px' }} />
          <div className="skeleton-box" style={{ width: '140px', height: '52px', borderRadius: '8px' }} />
        </div>
      </div>
      {showAssistant && (
        <div className="dora-ai-sidebar-panel" style={{ padding: '24px' }}>
          <div className="skeleton-box" style={{ width: '45%', height: '20px', marginBottom: '28px', borderRadius: '4px' }} />
          <div className="skeleton-box" style={{ width: '150px', height: '150px', margin: '0 auto 24px', borderRadius: '50%' }} />
          <div className="skeleton-box" style={{ width: '100%', height: '64px', marginBottom: '28px', borderRadius: '8px' }} />
          <div className="skeleton-box" style={{ width: '30%', height: '14px', marginBottom: '10px', borderRadius: '4px' }} />
          <div className="skeleton-box" style={{ width: '100%', height: '92px', borderRadius: '8px' }} />
        </div>
      )}
    </div>
  );
}

function MailAssistantPanel({ assistant, isZh, signature, t }) {
  if (!assistant.isActive) return null;
  return (
    <div className="dora-ai-sidebar-panel">
      <div className="dora-panel-header">
        <div className="dora-header-title">
          <Sparkles size={16} className="dora-sparkle-icon" />
          <h4>{t('email.assistantTitle', { name: assistant.name })}</h4>
        </div>
        <button
          type="button"
          aria-label={isZh ? '关闭邮件助手' : 'Close email assistant'}
          className="close-dora-btn"
          onClick={() => assistant.setIsActive(false)}
        >
          <X size={16} />
        </button>
      </div>

      <div className="dora-avatar-section">
        <div className="dora-image-wrapper">
          <img
            src={assistant.avatarUrl || '/dora_assistant_avatar.png'}
            alt={`${assistant.name} AI virtual mascot`}
            className="dora-3d-avatar"
          />
          <div className="dora-pulse-glow" />
        </div>
        <div className="dora-speech-bubble">
          <p>{isZh
            ? '告诉我你想怎么回复，我会结合这封邮件帮你写好。'
            : "Tell me how you'd like to reply, and I'll draft it from this email."}</p>
        </div>
      </div>

      <div className="dora-controls-section">
        <div className="dora-custom-prompt-container">
          <h5>{isZh ? '你的意图' : 'Your intent'}</h5>
          <div className="dora-input-wrapper">
            <textarea
              value={assistant.instruction}
              onChange={event => assistant.setInstruction(event.target.value)}
              placeholder={t('email.intentPlaceholder', { name: assistant.name })}
              rows="3"
            />
            <button
              className="dora-draft-submit-btn"
              onClick={() => assistant.generateReply(assistant.instruction)}
              disabled={!assistant.instruction.trim() || assistant.isDrafting}
            >
              {t('email.generateReply')}
            </button>
          </div>
        </div>
      </div>

      <div className="dora-result-section">
        {assistant.isDrafting && (
          <div className="dora-draft-loading">
            <span className="spinner" />
            <span>{t('email.assistantWait', { name: assistant.name })}</span>
          </div>
        )}
        {assistant.draft && !assistant.isDrafting && (
          <ApprovalCard
            action={{
              action_type: 'send_email',
              presentation: { renderer: 'email', signature },
              payload: {
                to: assistant.selectedEmail?.sender?.emailAddress?.address
                  || assistant.selectedEmail?.sender?.emailAddress?.name,
                subject: assistant.selectedEmail?.subject
                  ? `Re: ${assistant.selectedEmail.subject}`
                  : '',
                body: assistant.draft,
              },
            }}
            title={t('email.assistantReplyTab')}
            statusLabel={t('email.assistantDrafted', { name: assistant.name })}
            confirmText={t('email.assistantCopyDraft')}
            onConfirm={assistant.useDraftAsReply}
            assistantName={assistant.name}
          />
        )}
      </div>
    </div>
  );
}

export function EmailDetail({ assistant, authToken, isZh, signature, t, thread }) {
  return (
    <div className="email-reader-panel" style={{ position: 'relative' }}>
      {thread.isLoading ? (
        <EmailDetailSkeleton showAssistant={assistant.isActive} />
      ) : thread.selectedConversationKey && thread.messages.length > 0 ? (
        <div className="email-reader-split-layout">
          <div className="email-detail-column">
            <div className="email-detail-header">
              <button
                type="button"
                className="mobile-email-back-btn"
                onClick={thread.clearSelection}
                title={isZh ? '返回邮件列表' : 'Back to list'}
              >
                <ChevronLeft size={18} />
                <span>{isZh ? '返回' : 'Back'}</span>
              </button>
              <div className="email-detail-meta">
                <h2 className="email-detail-subject-full" title={thread.messages[0]?.subject}>
                  {thread.messages[0]?.subject}
                  {thread.messages.length > 1 && (
                    <span className="thread-msg-count-label">
                      {isZh
                        ? `${thread.messages.length} 封邮件`
                        : `${thread.messages.length} messages`}
                    </span>
                  )}
                </h2>
              </div>
              <div className="email-detail-actions">
                <button className="action-icon-btn" onClick={() => thread.openCompose('reply')}>
                  <Reply size={16} />
                  <span>{t('email.reply')}</span>
                </button>
                <button className="action-icon-btn" onClick={() => thread.openCompose('replyAll')}>
                  <ReplyAll size={16} />
                  <span>{t('email.replyAll')}</span>
                </button>
                <button className="action-icon-btn" onClick={() => thread.openCompose('forward')}>
                  <Forward size={16} />
                  <span>{t('email.forward')}</span>
                </button>
                <button
                  className={`action-icon-btn dora-toggle-btn ${assistant.isActive ? 'active' : ''}`}
                  onClick={() => assistant.setIsActive(!assistant.isActive)}
                >
                  <Sparkles size={16} />
                  <span>{t('email.assistantTitle', { name: assistant.name })}</span>
                </button>
              </div>
            </div>

            <div className="thread-timeline">
              {thread.messages.map((message, index) => {
                const isLatest = index === thread.messages.length - 1;
                const isExpanded = thread.expandedMessageIds.has(message.id);
                const senderName = message.sender?.emailAddress?.name || 'Unknown';
                const senderAddress = message.sender?.emailAddress?.address || '';
                return (
                  <div key={message.id} className={`thread-msg-entry ${isExpanded ? 'thread-msg-expanded' : 'thread-msg-collapsed'}`}>
                    <div
                      className="thread-msg-header"
                      onClick={() => thread.toggleExpanded(message.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={event => {
                        if (event.key === 'Enter') thread.toggleExpanded(message.id);
                      }}
                    >
                      <div className="sender-avatar-large" style={{ width: 34, height: 34, fontSize: 13, flexShrink: 0 }}>
                        {senderName[0]?.toUpperCase() || 'U'}
                      </div>
                      <div className="thread-msg-header-meta">
                        <div className="sender-name-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span className="sender-name">{senderName}</span>
                          {isExpanded ? (
                            <span className="sender-email">&lt;{senderAddress}&gt;</span>
                          ) : (
                            <span className="stub-preview">{message.bodyPreview}</span>
                          )}
                        </div>
                      </div>
                      <div className="thread-msg-header-right">
                        <span className="email-detail-date">
                          {isExpanded
                            ? `${formatEmailDateFull(message.receivedDateTime)} ${formatEmailTime(message.receivedDateTime)}`
                            : formatEmailTime(message.receivedDateTime)}
                        </span>
                        <span className="thread-expand-chevron">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <>
                        <div className="email-detail-body thread-msg-body">
                          <EmailContentRenderer
                            body={message.body || null}
                            messageId={message.id}
                            authToken={authToken}
                            inlineAttachments={message.attachments || []}
                          />
                        </div>
                        {message.hasAttachments && (
                          <EmailAttachments
                            messageId={message.id}
                            hasAttachments={message.hasAttachments}
                            authToken={authToken}
                            initialAttachments={message.attachments}
                          />
                        )}
                      </>
                    )}
                    {!isLatest && <div className="thread-msg-divider" />}
                  </div>
                );
              })}
            </div>
          </div>

          <MailAssistantPanel assistant={assistant} isZh={isZh} signature={signature} t={t} />
        </div>
      ) : (
        <div className="reader-empty-state">
          <Mail size={48} className="empty-state-icon" />
          <h3>{isZh ? '没有选择邮件' : 'No conversation selected'}</h3>
          <p>{t('email.selectEmail')}</p>
        </div>
      )}
    </div>
  );
}
