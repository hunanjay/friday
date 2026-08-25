import { apiRequest } from '../../api/client';

export function normalizeMemo(memo) {
  return {
    ...memo,
    updatedAt: Date.parse(memo.updated_at),
    dateStr: new Date(memo.updated_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

export async function getMemos(token) {
  const data = await apiRequest('/api/memos', { token });
  return (data?.memos || []).map(normalizeMemo);
}

export async function createMemo(token, memo) {
  const data = await apiRequest('/api/memos', {
    method: 'POST',
    token,
    body: memo,
  });
  return normalizeMemo(data);
}

export async function updateMemo(token, memo) {
  const data = await apiRequest(`/api/memos/${memo.id}`, {
    method: 'PUT',
    token,
    body: memo,
  });
  return normalizeMemo(data);
}

export async function deleteMemo(token, memoId) {
  await apiRequest(`/api/memos/${memoId}`, {
    method: 'DELETE',
    token,
  });
  return memoId;
}

export async function uploadMemoAttachment(token, file) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest('/api/memos/upload', {
    method: 'POST',
    token,
    body,
  });
}
