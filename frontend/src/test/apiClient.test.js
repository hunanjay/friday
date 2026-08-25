import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { ApiError } from '../api/errors';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('adds auth, query parameters, and a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/items?existing=yes', {
      method: 'POST',
      token: 'secret',
      query: { page: 2, tag: ['a', 'b'], ignored: null },
      body: { name: 'Friday' },
    })).resolves.toEqual({ ok: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/items?existing=yes&page=2&tag=a&tag=b');
    expect(options.headers.get('Authorization')).toBe('Bearer secret');
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(options.body).toBe('{"name":"Friday"}');
  });

  it('preserves FormData without setting a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.append('file', 'memo');

    await expect(apiRequest('/api/upload', { method: 'POST', body })).resolves.toBeNull();

    const options = fetchMock.mock.calls[0][1];
    expect(options.body).toBe(body);
    expect(options.headers.has('Content-Type')).toBe(false);
  });

  it('throws a typed error with backend details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: 'Session not found', code: 'missing_session' }),
      { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(apiRequest('/api/session')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Session not found',
      status: 404,
      code: 'missing_session',
      url: '/api/session',
    });
  });

  it('can return the raw response for streaming consumers', async () => {
    const response = new Response('data: [DONE]\n\n', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(apiRequest('/api/stream', { responseType: 'response' })).resolves.toBe(response);
  });

  it('passes the caller abort signal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/items', { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('exports ApiError as a concrete error type', () => {
    expect(new ApiError('failed')).toBeInstanceOf(Error);
  });
});
