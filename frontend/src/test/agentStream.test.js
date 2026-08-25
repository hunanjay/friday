import { describe, expect, it } from 'vitest';
import { readAgentEvents } from '../api/agentStream';

function chunkedStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function collect(stream) {
  const events = [];
  for await (const event of readAgentEvents(stream)) events.push(event);
  return events;
}

describe('readAgentEvents', () => {
  it('parses events split across arbitrary network chunks', async () => {
    const stream = chunkedStream([
      'data: {"chunk":"Hel',
      'lo"}\n\ndata: {"final_message":"Hello"}\n',
      '\ndata: [DONE]\n\n',
    ]);

    await expect(collect(stream)).resolves.toEqual([
      { chunk: 'Hello' },
      { final_message: 'Hello' },
    ]);
  });

  it('supports CRLF and a final event without a blank line', async () => {
    const stream = chunkedStream([
      'data: {"preview":"one"}\r\n\r\n',
      'data: {"title":"Friday"}',
    ]);

    await expect(collect(stream)).resolves.toEqual([
      { preview: 'one' },
      { title: 'Friday' },
    ]);
  });

  it('combines multiline SSE data before decoding JSON', async () => {
    const stream = chunkedStream(['data: {"chunk":\ndata: "hello"}\n\n']);

    await expect(collect(stream)).resolves.toEqual([{ chunk: 'hello' }]);
  });

  it('rejects malformed JSON with a stable error code', async () => {
    const stream = chunkedStream(['data: definitely-not-json\n\n']);

    await expect(collect(stream)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'invalid_sse_event',
    });
  });

  it('rejects a missing response body', async () => {
    await expect(collect(null)).rejects.toMatchObject({
      code: 'missing_response_stream',
    });
  });
});
