import { describe, expect, it } from 'vitest';
import { parseAgentCommand } from '../utils/agentCommand';

describe('agent slash command rendering', () => {
  it('extracts the canonical calendar agent and visible message', () => {
    expect(parseAgentCommand('/calendar_agent arrange a meeting next Friday at 10AM')).toEqual({
      agentName: 'calendar_agent',
      message: 'arrange a meeting next Friday at 10AM',
    });
  });

  it('accepts the readable hyphenated alias', () => {
    expect(parseAgentCommand('/calendar-agent arrange a meeting')).toEqual({
      agentName: 'calendar_agent',
      message: 'arrange a meeting',
    });
  });

  it('leaves unknown commands as plain text', () => {
    expect(parseAgentCommand('/unknown-agent do something')).toBeNull();
  });
});
