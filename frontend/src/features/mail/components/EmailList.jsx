import React, { useMemo, useState } from 'react';
import { Mail, Search, Trash } from '../../../components/common/Icons';
import { formatMailListDate, groupMailThreads } from '../mailListModel';

export function EmailList({
  activeFolder,
  canLoadMoreFolder,
  canLoadMoreSearch,
  emails,
  isLoadingMoreFolder,
  isLoadingMoreSearch,
  isSearching,
  isSyncingSent,
  isZh,
  loadMoreFolder,
  loadMoreSearch,
  onCancelPrefetch,
  onDelete,
  onPrefetch,
  onSelect,
  searchQuery,
  searchResults,
  selectedConversationKey,
  setSearchQuery,
  t,
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const threadedEmails = useMemo(
    () => groupMailThreads(emails, activeFolder),
    [activeFolder, emails],
  );
  const isSearchMode = Boolean(searchQuery.trim());
  const rows = isSearchMode ? searchResults : threadedEmails;
  const canLoadMore = isSearchMode ? canLoadMoreSearch : canLoadMoreFolder;
  const isLoadingMore = isSearchMode ? isLoadingMoreSearch : isLoadingMoreFolder;
  const loadMore = isSearchMode ? loadMoreSearch : loadMoreFolder;

  return (
    <div className="email-list-panel">
      <div className="email-search-bar">
        <Search size={18} className="search-icon" />
        <input
          type="text"
          placeholder={t('email.searchPlaceholder')}
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
        />
      </div>

      <div className="email-list">
        {isSearching || isSyncingSent ? (
          <div className="email-empty-state">
            <p>{t('common.search')}...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="email-empty-state">
            <Mail size={32} />
            <p>{t('email.emptyState')}</p>
          </div>
        ) : rows.map(threadRow => {
          const isUnread = threadRow._hasUnread ?? !threadRow.isRead;
          const senderName = threadRow.sender?.emailAddress?.name || 'Unknown';
          const threadKey = threadRow._threadKey || threadRow.conversationId || threadRow.id;
          const isSelected = threadKey === selectedConversationKey;
          const count = threadRow._count || 1;
          return (
            <div
              key={threadKey}
              className={`email-list-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(threadRow)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(threadRow);
                }
              }}
              onMouseEnter={() => onPrefetch(threadRow)}
              onMouseLeave={() => onCancelPrefetch(threadRow)}
              onFocus={() => onPrefetch(threadRow)}
              onBlur={() => onCancelPrefetch(threadRow)}
            >
              <div className="email-item-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <div className="email-item-avatar">
                    {(senderName[0] || 'U').toUpperCase()}
                  </div>
                  <span className="email-item-sender">{senderName}</span>
                </div>
                <span className="email-item-date">
                  {formatMailListDate(threadRow.receivedDateTime, isZh)}
                </span>
              </div>
              <div className="email-item-subject">
                {threadRow.subject}
                {count > 1 && <span className="thread-count-badge">{count}</span>}
              </div>
              <div className="email-item-snippet">{threadRow.bodyPreview}</div>
              {isUnread && <span className="unread-dot" />}

              {threadRow.parentFolderId !== 'trash' && confirmDeleteId !== threadRow.id && (
                <button
                  type="button"
                  className="delete-email-item-btn"
                  title={t('common.delete')}
                  onClick={event => {
                    event.stopPropagation();
                    setConfirmDeleteId(threadRow.id);
                  }}
                >
                  <Trash size={14} />
                </button>
              )}
              {confirmDeleteId === threadRow.id && (
                <div className="email-delete-confirm-popover" onClick={event => event.stopPropagation()}>
                  <span>{isZh ? '移至废纸篓？' : 'Delete?'}</span>
                  <button
                    type="button"
                    className="confirm-delete-yes-btn"
                    onClick={event => {
                      event.stopPropagation();
                      setConfirmDeleteId(null);
                      onDelete(threadRow.id);
                    }}
                  >
                    {isZh ? '确定' : 'Yes'}
                  </button>
                  <button
                    type="button"
                    className="confirm-delete-no-btn"
                    onClick={event => {
                      event.stopPropagation();
                      setConfirmDeleteId(null);
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {!isSearching && canLoadMore && (
          <button
            type="button"
            className="load-more-emails-btn"
            onClick={loadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? `${t('email.loadMore')}...` : t('email.loadMore')}
          </button>
        )}
      </div>
    </div>
  );
}
