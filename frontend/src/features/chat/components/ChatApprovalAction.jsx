import React from 'react';
import ApprovalCard from '../../../components/common/ApprovalCard';

export function ChatApprovalAction({ action, assistantName, onDecision }) {
  return (
    <ApprovalCard
      action={action}
      onDecision={(decision, edits) => onDecision(action, decision, edits)}
      onCancel={() => onDecision(action, 'reject')}
      onConfirm={() => onDecision(action, 'approve')}
      assistantName={assistantName}
    />
  );
}
