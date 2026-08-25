import { describe, expect, it } from 'vitest';
import { createChatStreamState, transitionChatStream } from './streamState';

function apply(events) {
  let state = createChatStreamState();
  const effects = [];
  events.forEach(event => {
    const transition = transitionChatStream(state, event);
    state = transition.state;
    effects.push(transition.effect);
  });
  return { effects, state };
}

describe('chat stream state machine', () => {
  it('replaces typing chunks with the authoritative final message', () => {
    const { effects, state } = apply([
      { chunk: 'Draft ' },
      { chunk: 'answer' },
      { final_message: 'Final answer' },
    ]);

    expect(state).toEqual(expect.objectContaining({ text: 'Final answer', status: 'complete' }));
    expect(effects.at(-1)).toEqual({ message: { text: 'Final answer' } });
  });

  it('pairs a completed tool call with its running entry', () => {
    const { state } = apply([
      { tool_call: { name: 'search_mail', status: 'running' } },
      { tool_call: { name: 'search_mail', status: 'completed', result: 'done' } },
    ]);

    expect(state.toolCalls).toEqual([
      { name: 'search_mail', status: 'completed', result: 'done' },
    ]);
  });

  it('emits page-level session and approval effects without changing message state', () => {
    const initial = createChatStreamState();
    const title = transitionChatStream(initial, { title: 'Inbox review' });
    const preview = transitionChatStream(title.state, { preview: 'Reviewed mail' });
    const actions = transitionChatStream(preview.state, { pending_actions: [{ id: 'action-1' }] });

    expect(title.effect).toEqual({ sessionTitle: 'Inbox review' });
    expect(preview.effect).toEqual({ sessionPreview: 'Reviewed mail' });
    expect(actions.effect).toEqual({ pendingActions: [{ id: 'action-1' }] });
    expect(actions.state).toBe(initial);
  });

  it('surfaces stream errors in the assistant message', () => {
    const { effects, state } = apply([{ chunk: 'Partial' }, { error: 'provider failed' }]);

    expect(state.status).toBe('error');
    expect(state.text).toContain('Partial\n[Error: provider failed]');
    expect(effects.at(-1).message.text).toBe(state.text);
  });
});
