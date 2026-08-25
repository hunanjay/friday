import { describe, expect, it } from 'vitest';
import {
  mergeLiveApprovals,
  replaceDecisionApprovals,
  restorePersistedApprovals,
} from './approvalState';

describe('chat approval state', () => {
  it('restores recipient approvals beside distinct persisted bot messages', () => {
    const messages = [
      { id: 'user-1', sender: 'user', text: 'Email alice@example.com' },
      { id: 'bot-1', sender: 'bot', text: 'Draft for Alice' },
      { id: 'user-2', sender: 'user', text: 'Email bob@example.com' },
      { id: 'bot-2', sender: 'bot', text: 'Draft for Bob' },
    ];
    const actions = [
      { id: 'action-1', status: 'pending', payload: { to: 'alice@example.com' } },
      { id: 'action-2', status: 'completed', payload: { to: 'bob@example.com' } },
    ];

    expect(restorePersistedApprovals(actions, messages)).toEqual([
      expect.objectContaining({ id: 'action-1', anchorMessageId: 'bot-1', resolved: false }),
      expect.objectContaining({ id: 'action-2', anchorMessageId: 'bot-2', resolved: true }),
    ]);
  });

  it('keeps a live optimistic anchor across subsequent stream updates', () => {
    const initial = mergeLiveApprovals([], [{ id: 'action-1', status: 'pending' }], 'bot-local');
    const updated = mergeLiveApprovals(initial, [{ id: 'action-1', status: 'failed' }], 'bot-new');

    expect(updated).toEqual([
      expect.objectContaining({
        id: 'action-1',
        anchorMessageId: 'bot-local',
        resolved: true,
      }),
    ]);
  });

  it('preserves placement when a decision returns the refreshed action list', () => {
    const previous = [{ id: 'action-1', anchorMessageId: 'bot-local' }];
    const refreshed = replaceDecisionApprovals(previous, [{ id: 'action-1', status: 'completed' }]);

    expect(refreshed).toEqual([
      expect.objectContaining({ anchorMessageId: 'bot-local', resolved: true }),
    ]);
  });
});
