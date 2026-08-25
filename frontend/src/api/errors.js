export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null, url = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.url = url;
  }
}

export function isApiError(error) {
  return error instanceof ApiError;
}

export function isAbortError(error) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error?.name === 'AbortError';
}
