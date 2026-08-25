import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAgentChat } from '../../api/agentStream';
import { createChatStreamState, transitionChatStream } from './streamState';

export function useAgentChatStream() {
  const controllerRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const stopAgentStream = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const startAgentStream = useCallback(async ({ message, sessionId, token, onTransition }) => {
    if (controllerRef.current) return false;

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsStreaming(true);
    let state = createChatStreamState();

    try {
      for await (const event of streamAgentChat({
        message,
        sessionId,
        token,
        signal: controller.signal,
      })) {
        const transition = transitionChatStream(state, event);
        state = transition.state;
        onTransition?.(transition.effect, state);
      }
      return true;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { isStreaming, startAgentStream, stopAgentStream };
}
