import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  createContact,
  deleteContact,
  deleteContactFact,
  getContactTags,
  getContacts,
  syncMicrosoftContacts,
  updateContact,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('contacts API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads tags, defaulting to an empty array for a non-array response', async () => {
    apiRequest.mockResolvedValueOnce(['work', 'family']);
    await expect(getContactTags('token')).resolves.toEqual(['work', 'family']);
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts/tags', { token: 'token' });

    apiRequest.mockResolvedValueOnce(null);
    await expect(getContactTags('token')).resolves.toEqual([]);
  });

  it('loads contacts with the query and tag filters', async () => {
    apiRequest.mockResolvedValueOnce([{ id: '1' }]);
    await expect(getContacts('token', { query: 'ada', tag: 'work' })).resolves.toEqual([{ id: '1' }]);
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts', {
      token: 'token',
      signal: undefined,
      query: { query: 'ada', tag: 'work' },
    });
  });

  it('syncs contacts from Microsoft', async () => {
    apiRequest.mockResolvedValueOnce({ created: 1, updated: 2, total: 3 });
    await expect(syncMicrosoftContacts('token')).resolves.toEqual({ created: 1, updated: 2, total: 3 });
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts/sync/microsoft', { method: 'POST', token: 'token' });
  });

  it('creates a contact', async () => {
    const contact = { name: 'Ada' };
    apiRequest.mockResolvedValueOnce({ id: '1', ...contact });
    await expect(createContact('token', contact)).resolves.toEqual({ id: '1', ...contact });
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts', { method: 'POST', token: 'token', body: contact });
  });

  it('updates a contact', async () => {
    apiRequest.mockResolvedValueOnce({ id: '1', name: 'Ada Lovelace' });
    await expect(updateContact('token', '1', { name: 'Ada Lovelace' })).resolves.toEqual({ id: '1', name: 'Ada Lovelace' });
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts/1', {
      method: 'PATCH',
      token: 'token',
      body: { name: 'Ada Lovelace' },
    });
  });

  it('deletes a contact and resolves with its id', async () => {
    apiRequest.mockResolvedValueOnce(null);
    await expect(deleteContact('token', '1')).resolves.toBe('1');
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts/1', { method: 'DELETE', token: 'token' });
  });

  it('deletes a fact and resolves with its id', async () => {
    apiRequest.mockResolvedValueOnce(null);
    await expect(deleteContactFact('token', '1', 'fact-1')).resolves.toBe('fact-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/contacts/1/facts/fact-1', { method: 'DELETE', token: 'token' });
  });
});
