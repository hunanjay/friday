const AGENT_IDS = ['mail_agent', 'contact_agent', 'calendar_agent', 'memos_agent', 'github_agent'];

export function parseAgentPrefix(text) {
  const match = text.match(/^\/([\w-]+)(?:\s+|$)/);
  if (!match) return null;
  const agentName = match[1].replaceAll('-', '_');
  if (!AGENT_IDS.includes(agentName)) return null;
  return {
    agentName,
    message: text.slice(match[0].length),
  };
}

export function parseAgentCommand(text) {
  const parsed = parseAgentPrefix(text.trimStart());
  if (!parsed || !parsed.message.trim()) return null;
  return { agentName: parsed.agentName, message: parsed.message.trim() };
}
