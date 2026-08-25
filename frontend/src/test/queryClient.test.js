import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { createAppQueryClient } from '../app/queryClient';

describe('createAppQueryClient', () => {
  it('does not retry client errors', () => {
    const client = createAppQueryClient();
    const retry = client.getDefaultOptions().queries.retry;

    expect(retry(0, new ApiError('Unauthorized', { status: 401 }))).toBe(false);
    expect(retry(0, new ApiError('Server error', { status: 500 }))).toBe(true);
    expect(retry(2, new Error('Network error'))).toBe(false);
  });
});
