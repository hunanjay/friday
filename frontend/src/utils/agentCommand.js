const AGENT_IDS = ['mail_agent', 'calendar_agent', 'memos_agent', 'github_agent'];

export function parseAgentCommand(text) {
  const match = text.trimStart().match(/^\/([\w-]+)\s+([\s\S]+)$/);
  if (!match) return null;
  const agentName = match[1].replaceAll('-', '_');
  if (!AGENT_IDS.includes(agentName)) return null;
  return { agentName, message: match[2].trim() };
}
