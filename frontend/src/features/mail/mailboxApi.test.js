import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  getInboxUnread,
  getMailFolderPage,
  mailChannelPath,
  normalizeMailMessage,
} from './mailboxApi';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('mailbox API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums Microsoft and bound-account unread counts', async () => {
    apiRequest
      .mockResolvedValueOnce({ unread: 2 })
      .mockResolvedValueOnce({ unread: 3 });

    await expect(getInboxUnread('token', ['mail-1'])).resolves.toBe(5);
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/graph/mail/folders/inbox', { token: 'token' });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/mail-accounts/mail-1/mail/folders/inbox', { token: 'token' });
  });

  it('keeps counts from healthy providers when one mailbox fails', async () => {
    apiRequest
      .mockResolvedValueOnce({ unread: 2 })
      .mockRejectedValueOnce(new Error('mailbox unavailable'))
      .mockResolvedValueOnce({ unread: 4 });

    await expect(getInboxUnread('token', ['mail-1', 'mail-2'])).resolves.toBe(6);
  });

  it('loads Microsoft and IMAP folder pages through one channel contract', async () => {
    apiRequest.mockResolvedValue({ value: [], next_cursor: null });

    await getMailFolderPage('token', {
      channel: 'mail/account',
      folder: 'sent',
      cursor: 'next page',
    });
    expect(mailChannelPath('microsoft')).toBe('/api/graph/mail');
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/mail-accounts/mail%2Faccount/mail/sent',
      { token: 'token', query: { cursor: 'next page' } },
    );
  });

  it('normalizes provider messages without retaining full HTML bodies', () => {
    const normalized = normalizeMailMessage({
      id: 'imap:mail-1:INBOX:3',
      provider: 'imap',
      subject: 'Hello',
      body: { content: '<p>large body</p>' },
      hasAttachments: 1,
    }, 'inbox');

    expect(normalized).toEqual(expect.objectContaining({
      id: 'imap:mail-1:INBOX:3',
      provider: 'mail-1',
      parentFolderId: 'inbox',
      hasAttachments: true,
    }));
    expect(normalized).not.toHaveProperty('body');
  });
});
