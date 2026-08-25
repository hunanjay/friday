import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamAgentChat } from '../../api/agentStream';
import { useAgentChatStream } from './useAgentChatStream';

vi.mock('../../api/agentStream', () => ({ streamAgentChat: vi.fn() }));

describe('useAgentChatStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits state-machine transitions and permits a later stream', async () => {
    streamAgentChat.mockImplementation(async function* () {
      yield { chunk: 'typing' };
      yield { final_message: 'final' };
    });
    const onTransition = vi.fn();
    const { result } = renderHook(() => useAgentChatStream());

    await act(async () => {
      await result.current.startAgentStream({
        message: 'hello',
        sessionId: 'session-1',
        token: 'token',
        onTransition,
      });
    });
    await act(async () => {
      await result.current.startAgentStream({
        message: 'again',
        sessionId: 'session-1',
        token: 'token',
        onTransition,
      });
    });

    expect(streamAgentChat).toHaveBeenCalledTimes(2);
    expect(onTransition).toHaveBeenCalledWith(
      { message: { text: 'final' } },
      expect.objectContaining({ text: 'final', status: 'complete' }),
    );
    expect(result.current.isStreaming).toBe(false);
  });

  it('aborts the active stream and resets its lifecycle state', async () => {
    streamAgentChat.mockImplementation(async function* ({ signal }) {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
      yield { done: true };
    });
    const { result } = renderHook(() => useAgentChatStream());

    let streamPromise;
    act(() => {
      streamPromise = result.current.startAgentStream({
        message: 'hello',
        sessionId: 'session-1',
        token: 'token',
      });
    });
    const settled = streamPromise.catch(error => error);
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    let abortError;
    await act(async () => {
      result.current.stopAgentStream();
      abortError = await settled;
    });
    expect(abortError).toEqual(expect.objectContaining({ name: 'AbortError' }));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });
});
