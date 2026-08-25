import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  createMemo,
  deleteMemo,
  getMemos,
  normalizeMemo,
  updateMemo,
  uploadMemoAttachment,
} from './api';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

const rawMemo = {
  id: 'memo-1',
  title: 'First',
  updated_at: '2026-08-25T01:02:03Z',
};

describe('memos API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes backend timestamps for existing consumers', () => {
    expect(normalizeMemo(rawMemo)).toEqual(expect.objectContaining({
      id: 'memo-1',
      updatedAt: Date.parse(rawMemo.updated_at),
      dateStr: expect.any(String),
    }));
  });

  it('loads and normalizes the memo list', async () => {
    apiRequest.mockResolvedValueOnce({ memos: [rawMemo] });

    await expect(getMemos('token')).resolves.toEqual([
      expect.objectContaining({ id: 'memo-1', updatedAt: Date.parse(rawMemo.updated_at) }),
    ]);
    expect(apiRequest).toHaveBeenCalledWith('/api/memos', { token: 'token' });
  });

  it.each([
    ['creates', createMemo, '/api/memos', 'POST', { title: 'First' }],
    ['updates', updateMemo, '/api/memos/memo-1', 'PUT', { id: 'memo-1', title: 'First' }],
  ])('%s and normalizes a memo', async (_label, request, path, method, body) => {
    apiRequest.mockResolvedValueOnce(rawMemo);

    await expect(request('token', body)).resolves.toEqual(expect.objectContaining({
      id: 'memo-1',
      updatedAt: Date.parse(rawMemo.updated_at),
    }));
    expect(apiRequest).toHaveBeenCalledWith(path, { method, token: 'token', body });
  });

  it('deletes and returns the removed memo id', async () => {
    apiRequest.mockResolvedValueOnce({ status: 'ok' });

    await expect(deleteMemo('token', 'memo-1')).resolves.toBe('memo-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/memos/memo-1', {
      method: 'DELETE',
      token: 'token',
    });
  });

  it('uploads attachments as multipart form data', async () => {
    const file = new File(['memo'], 'memo.txt', { type: 'text/plain' });
    apiRequest.mockResolvedValueOnce({ name: 'memo.txt' });

    await expect(uploadMemoAttachment('token', file)).resolves.toEqual({ name: 'memo.txt' });
    const [, options] = apiRequest.mock.calls[0];
    expect(apiRequest.mock.calls[0][0]).toBe('/api/memos/upload');
    expect(options).toEqual(expect.objectContaining({ method: 'POST', token: 'token' }));
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('file')).toBe(file);
  });
});
