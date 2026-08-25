import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  deleteMailMessage,
  getInboxUnread,
  getMailMessage,
  getMailFolderPage,
  getMailThread,
  getMailThreadResource,
  generateMailReply,
  mailChannelPath,
  markMailMessageRead,
  normalizeMailMessage,
  saveMicrosoftDraft,
  searchMailPage,
  sendMail,
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

  it('uses query parameters for initial search and only the opaque cursor afterward', async () => {
    apiRequest.mockResolvedValue({ value: [], next_cursor: null });
    const signal = new AbortController().signal;

    await searchMailPage('token', {
      channel: 'microsoft',
      folder: 'deleted',
      query: 'quarterly report',
      signal,
    });
    await searchMailPage('token', {
      channel: 'microsoft',
      cursor: 'opaque cursor',
    });
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/graph/mail/search', {
      token: 'token',
      signal,
      query: { query: 'quarterly report', folder: 'deleted', top: 25 },
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/graph/mail/search', {
      token: 'token',
      signal: undefined,
      query: { cursor: 'opaque cursor' },
    });
  });

  it('loads conversation and standalone thread resources with provider-aware paths', async () => {
    apiRequest
      .mockResolvedValueOnce({ value: [{ id: 'message-1' }] })
      .mockResolvedValueOnce({ id: 'imap:mail-1:INBOX:3' });
    const conversation = {
      id: 'message-1',
      provider: 'mail/account',
      conversationId: 'conversation/1',
    };
    const standalone = { id: 'imap:mail-1:INBOX:3', provider: 'mail-1' };

    await expect(getMailThread('token', conversation)).resolves.toEqual([{ id: 'message-1' }]);
    await expect(getMailThread('token', standalone)).resolves.toEqual([
      { id: 'imap:mail-1:INBOX:3' },
    ]);
    expect(getMailThreadResource(conversation)).toEqual(expect.objectContaining({
      key: 'conversation:mail/account:conversation/1',
      path: '/api/mail-accounts/mail%2Faccount/mail/conversation/conversation%2F1',
    }));
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/mail/imap%3Amail-1%3AINBOX%3A3',
      { token: 'token' },
    );
  });

  it('loads a linked message and marks it read through the shared client', async () => {
    apiRequest.mockResolvedValue({ id: 'graph-message' });

    await getMailMessage('token', 'graph/message');
    await markMailMessageRead('token', 'graph/message');
    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/graph/mail/graph%2Fmessage', {
      token: 'token',
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/graph/mail/graph%2Fmessage/read', {
      method: 'PATCH',
      token: 'token',
      body: { is_read: true },
    });
  });

  it('creates and updates Microsoft drafts as multipart requests', async () => {
    apiRequest.mockResolvedValue({ id: 'draft-1' });

    await saveMicrosoftDraft('token', {
      to: 'person@example.com',
      subject: 'Draft',
      body: 'Hello',
    });
    await saveMicrosoftDraft('token', {
      draftId: 'draft/1',
      to: 'person@example.com',
      subject: 'Updated',
      body: 'Hello again',
    });

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/api/graph/mail/drafts', {
      method: 'POST',
      token: 'token',
      body: expect.any(FormData),
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, '/api/graph/mail/drafts/draft%2F1', {
      method: 'PATCH',
      token: 'token',
      body: expect.any(FormData),
    });
    expect(apiRequest.mock.calls[1][1].body.get('subject')).toBe('Updated');
  });

  it('sends fresh, reply-all, and forward mail through provider-aware paths', async () => {
    apiRequest.mockResolvedValue({ status: 'sent' });
    const attachment = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    await sendMail('token', {
      channel: 'mail/account',
      to: 'person@example.com',
      subject: 'Fresh',
      body: 'Hello',
      attachments: [attachment],
    });
    await sendMail('token', {
      messageId: 'graph/message',
      mode: 'replyAll',
      to: 'person@example.com',
      subject: 'Re: Thread',
      body: 'Reply',
    });
    await sendMail('token', {
      messageId: 'imap:mail-1:INBOX:1',
      mode: 'forward',
      to: 'next@example.com',
      subject: 'Fwd: Thread',
      body: 'Forward',
    });

    expect(apiRequest.mock.calls[0][0]).toBe('/api/mail-accounts/mail%2Faccount/mail/send');
    expect(apiRequest.mock.calls[0][1].body.get('attachments')).toBe(attachment);
    expect(apiRequest.mock.calls[1][0]).toBe('/api/graph/mail/graph%2Fmessage/reply');
    expect(apiRequest.mock.calls[1][1].body.get('reply_all')).toBe('true');
    expect(apiRequest.mock.calls[2][0]).toBe('/api/mail/imap%3Amail-1%3AINBOX%3A1/forward');
  });

  it('deletes a mirrored draft permanently through a query parameter', async () => {
    apiRequest.mockResolvedValue(null);

    await deleteMailMessage('token', 'draft/1', { permanent: true });

    expect(apiRequest).toHaveBeenCalledWith('/api/graph/mail/draft%2F1', {
      method: 'DELETE',
      token: 'token',
      query: { permanent: true },
    });
  });

  it('requests an assistant reply through the shared JSON client', async () => {
    apiRequest.mockResolvedValue({ draft: 'Suggested reply' });

    await expect(generateMailReply('token', {
      emailId: 'message-1',
      intent: 'Accept the meeting',
      userName: 'Ada',
    })).resolves.toEqual({ draft: 'Suggested reply' });
    expect(apiRequest).toHaveBeenCalledWith('/api/agent/draft-reply', {
      method: 'POST',
      token: 'token',
      body: {
        email_id: 'message-1',
        intent: 'Accept the meeting',
        my_name: 'Ada',
      },
    });
  });
});
