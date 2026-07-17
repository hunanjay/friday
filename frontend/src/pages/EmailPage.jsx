import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Search, Plus, X, Sparkles } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

// Shared shape for both the inbox sync and search responses, since both are
// arrays of raw Graph message objects.
function normalizeMessage(msg, parentFolderId) {
  return {
    id: msg.id,
    subject: msg.subject,
    bodyPreview: msg.bodyPreview,
    body: msg.body,
    sender: msg.sender,
    toRecipients: msg.toRecipients,
    receivedDateTime: msg.receivedDateTime,
    isRead: msg.isRead,
    parentFolderId,
  };
}

export default function EmailPage() {
  const {
    user,
    emails,
    handleAddEmail,
    handleDeleteEmail,
    handleMarkEmailRead,
    showToast,
    authToken,
    setIsSyncingInbox,
    inboxUnread,
    adjustInboxUnread,
    handleSyncInboxEmails,
    handleAppendInboxEmails,
    handleLogout,
    setIsSidebarCollapsed
  } = useWorkspace();

  const { t, i18n } = useTranslation();

  const [activeFolder, setActiveFolder] = useState('inbox');
  const [selectedEmailId, setSelectedEmailId] = useState(emails.length > 0 ? emails[0].id : null);
  const [searchQuery, setSearchQuery] = useState('');

  // Cursor pagination: each fetch (initial sync, search, or "load more")
  // returns next_cursor - Graph's @odata.nextLink passed straight back as
  // `cursor` to fetch the following page. null/undefined means no more pages.
  const [inboxCursor, setInboxCursor] = useState(null);
  const [isLoadingMoreInbox, setIsLoadingMoreInbox] = useState(false);

  // Sync Inbox. Gated on presence (hasAuthToken), not the token's exact
  // value, so periodic Supabase token refreshes don't re-trigger a refetch.
  // (The authoritative unread count is fetched in WorkspaceContext so the
  // sidebar badge shares it.)
  const hasAuthToken = Boolean(authToken);
  useEffect(() => {
    if (!authToken) return;
    setIsSyncingInbox(true);
    fetch(`${API_URL}/api/graph/mail/inbox`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => {
        if (res.status === 401) {
          handleLogout();
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        handleSyncInboxEmails((data.value || []).map(msg => normalizeMessage(msg, 'inbox')));
        setInboxCursor(data.next_cursor || null);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsSyncingInbox(false));
  }, [hasAuthToken, t, showToast, setIsSyncingInbox, handleSyncInboxEmails, handleLogout]);

  const handleLoadMoreInbox = () => {
    if (!inboxCursor || isLoadingMoreInbox) return;
    setIsLoadingMoreInbox(true);
    fetch(`${API_URL}/api/graph/mail/inbox?cursor=${encodeURIComponent(inboxCursor)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
      .then(data => {
        handleAppendInboxEmails((data.value || []).map(msg => normalizeMessage(msg, 'inbox')));
        setInboxCursor(data.next_cursor || null);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsLoadingMoreInbox(false));
  };

  // Compose modal states
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  // Set by handleUseDraftAsReply - when present, submit hits Graph's
  // {id}/reply endpoint (keeps threading) instead of a fresh /send.
  const [replyToEmailId, setReplyToEmailId] = useState(null);

  // Dora AI Assistant states
  const [isDoraActive, setIsDoraActive] = useState(true);
  const [aiDraft, setAiDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');

  // Outlook Graph API Date Format Helpers
  const formatEmailTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatEmailDateFull = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // List row: always date + time together (e.g. "Jul 10 11:43") so a row
  // never shows a bare clock time with no way to tell which day it's from.
  // Locale follows the app's language (i18n), not the browser's.
  const formatEmailListDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = i18n.language === 'zh'
      ? date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${day} ${time}`;
  };

  // Clear AI draft when selecting a new email
  useEffect(() => {
    setAiDraft('');
    setAiInstruction('');
  }, [selectedEmailId]);

  // Filter emails by folder
  const folderEmails = emails.filter(email => {
    if (activeFolder === 'inbox') return email.parentFolderId === 'inbox';
    if (activeFolder === 'sent') return email.parentFolderId === 'sent';
    if (activeFolder === 'trash') return email.parentFolderId === 'trash';
    return true;
  });

  // Search hits the real backend (/api/graph/mail/search), debounced, scoped
  // to the active folder. Empty query falls back to the locally synced list.
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState(null);
  const [isLoadingMoreSearch, setIsLoadingMoreSearch] = useState(false);

  const searchGraphFolder = { inbox: 'inbox', sent: 'sent', trash: 'deleted' }[activeFolder] || 'inbox';

  useEffect(() => {
    if (!authToken || !searchQuery.trim()) {
      setSearchResults([]);
      setSearchCursor(null);
      return;
    }
    const controller = new AbortController();
    setIsSearching(true);
    const timer = setTimeout(() => {
      fetch(
        `${API_URL}/api/graph/mail/search?query=${encodeURIComponent(searchQuery)}&folder=${searchGraphFolder}&top=25`,
        { headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal }
      )
        .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
        .then(data => {
          setSearchResults((data.value || []).map(msg => normalizeMessage(msg, activeFolder)));
          setSearchCursor(data.next_cursor || null);
        })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, activeFolder, authToken, searchGraphFolder]);

  const handleLoadMoreSearch = () => {
    if (!searchCursor || isLoadingMoreSearch) return;
    setIsLoadingMoreSearch(true);
    // Graph's $skip pagination is offset-based, so a shifting result set can
    // return an email we already have; capture the query this page belongs to
    // and drop the response if the user has since retyped (avoids mixing old
    // and new results), then dedupe by id on append.
    const forQuery = searchQuery;
    fetch(`${API_URL}/api/graph/mail/search?cursor=${encodeURIComponent(searchCursor)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
      .then(data => {
        if (forQuery !== searchQuery) return;
        setSearchResults(prev => {
          const seen = new Set(prev.map(e => e.id));
          const next = (data.value || [])
            .map(msg => normalizeMessage(msg, activeFolder))
            .filter(e => !seen.has(e.id));
          return [...prev, ...next];
        });
        setSearchCursor(data.next_cursor || null);
      })
      .catch(() => {})
      .finally(() => setIsLoadingMoreSearch(false));
  };

  const isSearchMode = Boolean(searchQuery.trim());
  const filteredEmails = isSearchMode ? searchResults : folderEmails;
  // Non-search "load more" only fetches the inbox; Sent/Trash are local-only
  // for now, so don't offer it there (it would pull inbox mail into the store).
  const canLoadMore = isSearchMode
    ? Boolean(searchCursor)
    : activeFolder === 'inbox' && Boolean(inboxCursor);
  const isLoadingMore = isSearchMode ? isLoadingMoreSearch : isLoadingMoreInbox;
  const handleLoadMore = isSearchMode ? handleLoadMoreSearch : handleLoadMoreInbox;

  const selectedEmail = [...emails, ...searchResults].find(e => e.id === selectedEmailId);

  const handleComposeSubmit = async (e) => {
    e.preventDefault();
    if (!composeTo || !composeSubject || !composeBody) {
      alert('Please fill out all fields');
      return;
    }

    const isZh = i18n.language === 'zh';
    setIsSending(true);
    try {
      const res = replyToEmailId
        ? await fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(replyToEmailId)}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ body: composeBody }),
          })
        : await fetch(`${API_URL}/api/graph/mail/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
          });

      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) {
        showToast(isZh ? '发送失败，请稍后重试' : 'Failed to send, please try again');
        return;
      }

      // Sent/Trash are local-only for now (see the sync effect above), so
      // this optimistic entry is what makes the Sent tab show it at all.
      handleAddEmail({
        id: 'email_' + Date.now(),
        subject: composeSubject,
        bodyPreview: composeBody.substring(0, 120) + (composeBody.length > 120 ? '...' : ''),
        body: { content: composeBody, contentType: 'text' },
        sender: { emailAddress: { name: 'You', address: user?.email || 'me@workspace.com' } },
        toRecipients: [{ emailAddress: { name: composeTo.split('@')[0], address: composeTo } }],
        receivedDateTime: new Date().toISOString(),
        isRead: true,
        parentFolderId: 'sent',
      });
      setIsComposing(false);
      setReplyToEmailId(null);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      showToast(t('email.sentSuccess'));
    } catch {
      showToast(isZh ? '无法连接到邮件服务，请稍后再试。' : "Couldn't reach the mail service, please try again later.");
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = (id) => {
    const target = filteredEmails.find(e => e.id === id);
    if (target && !target.isRead && target.parentFolderId === 'inbox') adjustInboxUnread(-1);
    handleDeleteEmail(id);
    showToast(t('email.movedToTrash'));
    const index = filteredEmails.findIndex(e => e.id === id);
    if (index !== -1 && filteredEmails.length > 1) {
      const nextSelect = filteredEmails[index === 0 ? 1 : index - 1];
      setSelectedEmailId(nextSelect.id);
    } else {
      setSelectedEmailId(null);
    }

    fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {});
  };

  const handleSelectEmail = (email) => {
    setSelectedEmailId(email.id);
    setIsSidebarCollapsed(true); // frees width for the Dora panel; reader still readable at 260px narrower
    if (email.isRead) return;
    handleMarkEmailRead(email.id, true);
    if (email.parentFolderId === 'inbox') adjustInboxUnread(-1);
    fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(email.id)}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ is_read: true }),
    }).catch(() => {});
  };

  // Dora reply generator: sends the selected email's id + the user's intent to
  // the backend, which fetches & sanitizes the original mail and asks the LLM
  // to write a reply carrying out that intent (not restating it).
  const handleGenerateReply = async (intent) => {
    if (!selectedEmail || !intent.trim()) return;
    const isZh = i18n.language === 'zh';
    setIsDrafting(true);
    setAiDraft('');
    try {
      const res = await fetch(`${API_URL}/api/agent/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ email_id: selectedEmail.id, intent, my_name: user?.name || '' }),
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAiDraft(data.draft);
        showToast(t('email.doraDrafted'));
      } else {
        setAiDraft(isZh ? `出错了：${data.detail || '生成失败'}` : `Something went wrong: ${data.detail || 'failed'}`);
      }
    } catch {
      setAiDraft(isZh ? '无法连接到助手服务，请稍后再试。' : "Couldn't reach the assistant service, please try again later.");
    } finally {
      setIsDrafting(false);
    }
  };

  const handleUseDraftAsReply = () => {
    if (!aiDraft) return;
    const senderAddress = selectedEmail.sender?.emailAddress?.address || selectedEmail.sender?.emailAddress?.name || '';
    setComposeTo(senderAddress);
    setComposeSubject(`Re: ${selectedEmail.subject}`);
    setComposeBody(aiDraft);
    setReplyToEmailId(selectedEmail.id);
    setIsComposing(true);
  };

  return (
    <div className="email-tab-container">
      {/* Email Sidebar */}
      <div className="email-sidebar">
        <button className="compose-btn" onClick={() => { setReplyToEmailId(null); setIsComposing(true); }}>
          <Plus size={18} />
          <span>{t('email.compose')}</span>
        </button>

        <nav className="email-folders">
          <button 
            className={`folder-item ${activeFolder === 'inbox' ? 'active' : ''}`}
            onClick={() => { setActiveFolder('inbox'); }}
          >
            <Mail size={16} />
            <span className="folder-name">{t('email.inbox')}</span>
            <span className="folder-count">
              {(inboxUnread ?? emails.filter(e => e.parentFolderId === 'inbox' && !e.isRead).length) || ''}
            </span>
          </button>
          <button 
            className={`folder-item ${activeFolder === 'sent' ? 'active' : ''}`}
            onClick={() => { setActiveFolder('sent'); }}
          >
            <Send size={16} />
            <span className="folder-name">{t('email.sent')}</span>
          </button>
          <button 
            className={`folder-item ${activeFolder === 'trash' ? 'active' : ''}`}
            onClick={() => { setActiveFolder('trash'); }}
          >
            <Trash size={16} />
            <span className="folder-name">{t('email.trash')}</span>
          </button>
        </nav>
      </div>

      {/* Email List */}
      <div className="email-list-panel">
        <div className="email-search-bar">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder={t('email.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="email-list">
          {isSearching ? (
            <div className="email-empty-state">
              <p>{t('common.search')}...</p>
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="email-empty-state">
              <Mail size={32} />
              <p>{t('email.emptyState')}</p>
            </div>
          ) : (
            filteredEmails.map(email => {
              const isUnread = !email.isRead;
              const senderName = email.sender?.emailAddress?.name || 'Unknown';
              const emailTime = formatEmailListDate(email.receivedDateTime);

              return (
                <div
                  key={email.id}
                  className={`email-list-item ${selectedEmailId === email.id ? 'selected' : ''} ${isUnread ? 'unread' : ''}`}
                  onClick={() => handleSelectEmail(email)}
                >
                  <div className="email-item-header">
                    <span className="email-item-sender">{senderName}</span>
                    <span className="email-item-date">{emailTime}</span>
                  </div>
                  <div className="email-item-subject">{email.subject}</div>
                  <div className="email-item-snippet">{email.bodyPreview}</div>
                  {isUnread && <span className="unread-dot"></span>}
                </div>
              );
            })
          )}

          {!isSearching && canLoadMore && (
            <button type="button" className="load-more-emails-btn" onClick={handleLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? `${t('email.loadMore')}...` : t('email.loadMore')}
            </button>
          )}
        </div>
      </div>

      {/* Email Reader */}
      <div className="email-reader-panel">
        {selectedEmail ? (
          <div className="email-reader-split-layout">
            <div className="email-detail-column">
              <div className="email-detail-header">
                <div className="sender-avatar-large">
                  {(selectedEmail.sender?.emailAddress?.name?.[0] || 'U').toUpperCase()}
                </div>
                <div className="email-detail-meta">
                  <div className="sender-name-row">
                    <span className="sender-name">{selectedEmail.sender?.emailAddress?.name || 'Unknown'}</span>
                    <span className="sender-email">&lt;{selectedEmail.sender?.emailAddress?.address || 'unknown@domain.com'}&gt;</span>
                  </div>
                  <div className="recipient-row">
                    {t('email.to')}: {selectedEmail.toRecipients?.[0]?.emailAddress?.name || selectedEmail.toRecipients?.[0]?.emailAddress?.address || 'me'}
                  </div>
                </div>
                <div className="email-detail-actions">
                  <button className={`action-icon-btn dora-toggle-btn ${isDoraActive ? 'active' : ''}`} onClick={() => setIsDoraActive(!isDoraActive)}>
                    <Sparkles size={16} />
                    <span>{t('email.doraTitle')}</span>
                  </button>
                  {selectedEmail.parentFolderId !== 'trash' && (
                    <button 
                      className="action-icon-btn delete-btn" 
                      onClick={() => handleDelete(selectedEmail.id)} 
                      title={t('common.delete')}
                    >
                      <Trash size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className="email-detail-subject-container">
                <h2 className="email-detail-subject">{selectedEmail.subject}</h2>
                <span className="email-detail-date">
                  {formatEmailDateFull(selectedEmail.receivedDateTime)} at {formatEmailTime(selectedEmail.receivedDateTime)}
                </span>
              </div>

              <div className="email-detail-body">
                <EmailContentRenderer body={selectedEmail.body} />
              </div>
            </div>

            {/* Dora-styled AI Assistant Panel */}
            {isDoraActive && (
              <div className="dora-ai-sidebar-panel">
                <div className="dora-panel-header">
                  <div className="dora-header-title">
                    <Sparkles size={16} className="dora-sparkle-icon" />
                    <h4>{t('email.doraTitle')}</h4>
                  </div>
                  <button className="close-dora-btn" onClick={() => setIsDoraActive(false)}>
                    <X size={16} />
                  </button>
                </div>

                <div className="dora-avatar-section">
                  <div className="dora-image-wrapper">
                    <img 
                      src="/dora_assistant_avatar.png" 
                      alt="Dora AI virtual mascot" 
                      className="dora-3d-avatar"
                    />
                    <div className="dora-pulse-glow"></div>
                  </div>
                  <div className="dora-speech-bubble">
                    <p>{i18n.language === 'zh' ? "告诉我你想怎么回复，我会结合这封邮件帮你写好。" : "Tell me how you'd like to reply, and I'll draft it from this email."}</p>
                  </div>
                </div>

                <div className="dora-controls-section">
                  <div className="dora-custom-prompt-container">
                    <h5>{i18n.language === 'zh' ? "你的意图" : "Your intent"}</h5>
                    <div className="dora-input-wrapper">
                      <textarea
                        value={aiInstruction}
                        onChange={(e) => setAiInstruction(e.target.value)}
                        placeholder={t('email.intentPlaceholder')}
                        rows="3"
                      />
                      <button
                        className="dora-draft-submit-btn"
                        onClick={() => handleGenerateReply(aiInstruction)}
                        disabled={!aiInstruction.trim() || isDrafting}
                      >
                        {t('email.generateReply')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="dora-result-section">
                  {isDrafting && (
                    <div className="dora-draft-loading">
                      <span className="spinner"></span>
                      <span>{t('email.doraWait')}</span>
                    </div>
                  )}

                  {aiDraft && !isDrafting && (
                    <div className="dora-draft-result-card">
                      <div className="dora-result-header">
                        <h6>{t('email.doraReplyTab')}</h6>
                        <button
                          className="use-draft-btn"
                          onClick={handleUseDraftAsReply}
                        >
                          {t('email.doraCopyDraft')}
                        </button>
                      </div>
                      <div className="dora-result-body">
                        {aiDraft.split('\n').map((line, i) => (
                          <p key={i}>{line || '\u00a0'}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="reader-empty-state">
            <Mail size={48} className="empty-state-icon" />
            <h3>{i18n.language === 'zh' ? "没有选择邮件" : "No conversation selected"}</h3>
            <p>{t('email.selectEmail')}</p>
          </div>
        )}
      </div>

      {/* Compose Modal */}
      {isComposing && (
        <div className="compose-modal-overlay">
          <div className="compose-modal">
            <div className="compose-modal-header">
              <h3>{i18n.language === 'zh' ? "新建邮件" : "New Message"}</h3>
              <button className="close-compose" onClick={() => setIsComposing(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleComposeSubmit} className="compose-form">
              <div className="compose-input-group">
                <label htmlFor="compose-to">{t('email.to')}:</label>
                <input
                  type="email"
                  id="compose-to"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="recipients@email.com"
                  required
                />
              </div>
              <div className="compose-input-group">
                <label htmlFor="compose-subject">{t('email.subject')}:</label>
                <input
                  type="text"
                  id="compose-subject"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Conversation topic"
                  required
                />
              </div>
              <div className="compose-body-group">
                <textarea
                  id="compose-body"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your email here..."
                  required
                />
              </div>
              <div className="compose-footer">
                <button type="submit" className="send-btn" disabled={isSending}>
                  <Send size={16} />
                  <span>{isSending ? `${t('email.send')}...` : t('email.send')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
