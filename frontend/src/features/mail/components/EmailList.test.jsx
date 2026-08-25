import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { groupMailThreads } from '../mailListModel';
import { EmailList } from './EmailList';

const EMAILS = [
  {
    id: 'message-old',
    conversationId: 'thread-1',
    parentFolderId: 'inbox',
    receivedDateTime: '2026-08-20T09:00:00Z',
    isRead: false,
    subject: 'Earlier',
    bodyPreview: 'First message',
    sender: { emailAddress: { name: 'Ada' } },
  },
  {
    id: 'message-new',
    conversationId: 'thread-1',
    parentFolderId: 'inbox',
    receivedDateTime: '2026-08-21T09:00:00Z',
    isRead: true,
    subject: 'Latest',
    bodyPreview: 'Second message',
    sender: { emailAddress: { name: 'Grace' } },
  },
  {
    id: 'message-sent',
    parentFolderId: 'sent',
    receivedDateTime: '2026-08-22T09:00:00Z',
    isRead: true,
    subject: 'Sent only',
    sender: { emailAddress: { name: 'Me' } },
  },
];

const t = key => key;

function listProps(overrides = {}) {
  return {
    activeFolder: 'inbox',
    canLoadMoreFolder: true,
    canLoadMoreSearch: false,
    emails: EMAILS,
    isLoadingMoreFolder: false,
    isLoadingMoreSearch: false,
    isSearching: false,
    isSyncingSent: false,
    isZh: false,
    loadMoreFolder: vi.fn(),
    loadMoreSearch: vi.fn(),
    onCancelPrefetch: vi.fn(),
    onDelete: vi.fn(),
    onPrefetch: vi.fn(),
    onSelect: vi.fn(),
    searchQuery: '',
    searchResults: [],
    selectedConversationKey: 'thread-1',
    setSearchQuery: vi.fn(),
    t,
    ...overrides,
  };
}

describe('EmailList', () => {
  it('groups folder messages by thread using the latest summary and unread aggregate', () => {
    expect(groupMailThreads(EMAILS, 'inbox')).toEqual([
      expect.objectContaining({
        id: 'message-new',
        _threadKey: 'thread-1',
        _count: 2,
        _hasUnread: true,
        subject: 'Latest',
      }),
    ]);
  });

  it('handles list selection, prefetch, deletion, search, and pagination', () => {
    const props = listProps();
    render(<EmailList {...props} />);

    const row = screen.getByText('Latest').closest('[role="button"]');
    expect(row).toHaveClass('selected', 'unread');
    expect(screen.getByText('2')).toHaveClass('thread-count-badge');
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(props.onPrefetch).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-new' }));
    expect(props.onCancelPrefetch).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-new' }));
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-new' }));

    fireEvent.click(screen.getByTitle('common.delete'));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(props.onDelete).toHaveBeenCalledWith('message-new');

    fireEvent.change(screen.getByPlaceholderText('email.searchPlaceholder'), {
      target: { value: 'quarterly' },
    });
    expect(props.setSearchQuery).toHaveBeenCalledWith('quarterly');
    fireEvent.click(screen.getByRole('button', { name: 'email.loadMore' }));
    expect(props.loadMoreFolder).toHaveBeenCalledOnce();
  });

  it('uses flat search results and search pagination while a query is active', () => {
    const loadMoreSearch = vi.fn();
    render(<EmailList {...listProps({
      canLoadMoreSearch: true,
      loadMoreSearch,
      searchQuery: 'result',
      searchResults: [{ ...EMAILS[2], subject: 'Matched result' }],
    })} />);

    expect(screen.getByText('Matched result')).toBeInTheDocument();
    expect(screen.queryByText('Latest')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'email.loadMore' }));
    expect(loadMoreSearch).toHaveBeenCalledOnce();
  });
});
