export function getApprovalPlacementMode(action) {
  return action?.placement?.mode || 'after_message';
}

export function resolveLiveApprovalAnchor(action, existingAnchor, optimisticBotMessageId) {
  if (getApprovalPlacementMode(action) !== 'after_message') return null;
  // While the SSE request is still live, the rendered bot message has a
  // client-generated id. The persisted LangGraph id only exists after a
  // history reload, so prefer the optimistic id for immediate placement.
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
