export function createChatStreamState() {
  return {
    text: '',
    toolCalls: [],
    status: 'streaming',
  };
}

function mergeToolCall(toolCalls, incoming) {
  const index = toolCalls.findIndex(call => (
    call.name === incoming.name && call.status === 'running'
  ));
  if (index >= 0 && incoming.status === 'completed') {
    const next = [...toolCalls];
    next[index] = { ...next[index], ...incoming };
    return next;
  }
  return index < 0 ? [...toolCalls, incoming] : toolCalls;
}

export function transitionChatStream(state, event) {
  if (event.error) {
    const text = `${state.text}\n[Error: ${event.error}]`;
    return {
      state: { ...state, text, status: 'error' },
      effect: { message: { text } },
    };
  }
  if (event.tool_call) {
    const toolCalls = mergeToolCall(state.toolCalls, event.tool_call);
    return {
      state: { ...state, toolCalls },
      effect: { message: { toolCalls } },
    };
  }
  if (event.chunk) {
    const text = state.text + event.chunk;
    return {
      state: { ...state, text },
      effect: { message: { text } },
    };
  }
  if (event.final_message) {
    return {
      state: { ...state, text: event.final_message, status: 'complete' },
      effect: { message: { text: event.final_message } },
    };
  }
  if (event.title) {
    return { state, effect: { sessionTitle: event.title } };
  }
  if (event.preview) {
    return { state, effect: { sessionPreview: event.preview } };
  }
  if (event.pending_actions) {
    return { state, effect: { pendingActions: event.pending_actions } };
  }
  if (event.done) {
    return { state: { ...state, status: 'complete' }, effect: {} };
  }
  return { state, effect: {} };
}
