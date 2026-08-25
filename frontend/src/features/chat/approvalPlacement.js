export function getApprovalPlacementMode(action) {
  return action?.placement?.mode || 'after_message';
}

export function resolveLiveApprovalAnchor(action, existingAnchor, optimisticBotMessageId) {
  if (getApprovalPlacementMode(action) !== 'after_message') return null;
  return existingAnchor
    || optimisticBotMessageId
    || action?.placement?.anchor_message_id
    || action?.anchor_message_id
    || null;
}

export function resolvePersistedApprovalAnchor(action, inferredAnchor) {
  if (getApprovalPlacementMode(action) !== 'after_message') return null;
  return action?.placement?.anchor_message_id
    || action?.anchor_message_id
    || inferredAnchor
    || null;
}
