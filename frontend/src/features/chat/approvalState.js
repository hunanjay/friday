import {
  resolveLiveApprovalAnchor,
  resolvePersistedApprovalAnchor,
} from './approvalPlacement';

export const isApprovalResolved = status => Boolean(status && status !== 'pending');

export function byApprovalPriority(left, right) {
  return (right.placement?.priority || 0) - (left.placement?.priority || 0);
}

export function restorePersistedApprovals(actions, messages) {
  const lastBotMessageId = [...messages].reverse().find(message => message.sender === 'bot')?.id;
  const usedAnchorIds = new Set();

  return actions.map(action => {
    const recipient = action.payload?.to?.toLowerCase();
    let matchingMessage = null;
    if (recipient) {
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.sender !== 'user' || !message.text?.toLowerCase().includes(recipient)) continue;
        matchingMessage = messages.slice(index + 1).find(candidate => (
          candidate.sender === 'bot' && !usedAnchorIds.has(candidate.id)
        ));
        if (matchingMessage) break;
      }
    }
    if (!matchingMessage && recipient) {
      matchingMessage = messages.find(message => (
        message.sender === 'bot'
        && !usedAnchorIds.has(message.id)
        && message.text?.toLowerCase().includes(recipient)
      ));
    }
    const anchorMessageId = resolvePersistedApprovalAnchor(
      action,
      matchingMessage?.id || lastBotMessageId,
    );
    if (anchorMessageId) usedAnchorIds.add(anchorMessageId);
    return {
      ...action,
      resolved: isApprovalResolved(action.status),
      anchorMessageId,
    };
  });
}

export function mergeLiveApprovals(previous, actions, optimisticBotMessageId) {
  const existingById = new Map(previous.map(action => [action.id, action]));
  return actions.map(action => ({
    ...action,
    resolved: isApprovalResolved(action.status),
    anchorMessageId: resolveLiveApprovalAnchor(
      action,
      existingById.get(action.id)?.anchorMessageId,
      optimisticBotMessageId,
    ),
  }));
}

export function replaceDecisionApprovals(previous, actions) {
  const existingById = new Map(previous.map(action => [action.id, action]));
  return actions.map(action => ({
    ...action,
    resolved: isApprovalResolved(action.status),
    anchorMessageId: existingById.get(action.id)?.anchorMessageId || action.anchorMessageId || null,
  }));
}
