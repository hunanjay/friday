import { apiRequest } from './client';
import { ApiError } from './errors';

function eventData(frame) {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  return data || null;
}

function decodeEvent(frame) {
  const data = eventData(frame);
  if (data == null || data === '[DONE]') return data;
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new ApiError('The agent returned a malformed stream event.', {
      code: 'invalid_sse_event',
      details: { data, cause: error.message },
    });
  }
}

function takeFrame(buffer) {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match) return null;
  return {
    frame: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  };
}

export async function* readAgentEvents(stream) {
  if (!stream) {
    throw new ApiError('The agent response did not include a readable stream.', {
      code: 'missing_response_stream',
    });
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let next;
      while ((next = takeFrame(buffer))) {
        buffer = next.rest;
        const event = decodeEvent(next.frame);
        if (event === '[DONE]') return;
        if (event != null) yield event;
      }

      if (done) break;
    }

    if (buffer.trim()) {
      const event = decodeEvent(buffer.trim());
      if (event !== '[DONE]' && event != null) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamAgentChat({ message, sessionId, token, signal }) {
  const response = await apiRequest('/api/agent/chat', {
    method: 'POST',
    token,
    signal,
    responseType: 'response',
    body: { message, session_id: sessionId },
  });
  yield* readAgentEvents(response.body);
}
