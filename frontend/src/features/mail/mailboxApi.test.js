import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import { getInboxUnread } from './mailboxApi';

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
});
