import { ApiError } from './errors';

const API_URL = import.meta.env.VITE_API_URL || '';

function requestUrl(path, query) {
  const base = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
  if (!query) return base;

  const [pathname, existingQuery = ''] = base.split('?', 2);
  const params = new URLSearchParams(existingQuery);
  Object.entries(query).forEach(([key, value]) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(item => params.append(key, String(item)));
      return;
    }
    params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}

function requestBody(body, headers) {
  if (body == null || typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
    return body;
  }
  if (body instanceof URLSearchParams || body instanceof ArrayBuffer) return body;
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(body);
}

async function responsePayload(response, responseType) {
  if (responseType === 'response') return response;
  if (response.status === 204) return null;
  if (responseType === 'blob') return response.blob();
  if (responseType === 'text') return response.text();

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(payload, response) {
  if (typeof payload === 'string' && payload) return payload;
  if (payload && typeof payload === 'object') {
    if (typeof payload.detail === 'string') return payload.detail;
    if (typeof payload.error === 'string') return payload.error;
    if (typeof payload.message === 'string') return payload.message;
  }
  return response.statusText || `Request failed with status ${response.status}`;
}

export async function apiRequest(path, options = {}) {
  const {
    token,
    query,
    responseType = 'json',
    headers: suppliedHeaders,
    body,
    ...fetchOptions
  } = options;
  const headers = new Headers(suppliedHeaders);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const url = requestUrl(path, query);
  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    body: requestBody(body, headers),
  });

  if (!response.ok) {
    const payload = await responsePayload(response, 'json');
    throw new ApiError(errorMessage(payload, response), {
      status: response.status,
      code: payload && typeof payload === 'object' ? payload.code ?? null : null,
      details: payload,
      url,
    });
  }

  return responsePayload(response, responseType);
}
