/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { Calendar, Mail, Trash } from './Icons';

function EmailPreview({ payload, t }) {
  return (
    <div className="approval-email-preview">
      {payload.to && (
        <div className="approval-email-recipient">
          <span>{t('email.to')}</span>
          <strong>{payload.to}</strong>
        </div>
      )}
      {payload.subject && <h4 className="approval-email-subject">{payload.subject}</h4>}
      {payload.body && (
        <div className="approval-email-body">
          <span>{t('email.body')}</span>
          <p>{payload.body}</p>
        </div>
      )}
    </div>
  );
}

function EmailDeletePreview({ payload, t }) {
  return (
    <div className="approval-details">
      {payload.subject && <Detail label={t('email.subject')} value={payload.subject} />}
      {payload.sender && <Detail label={t('chat.sender')} value={payload.sender} />}
    </div>
  );
}

function CalendarPreview({ payload, t }) {
  return (
    <div className="approval-details">
      {payload.day && <Detail label={t('calendar.date')} value={payload.day} />}
      {payload.subject && <Detail label={t('calendar.subject')} value={payload.subject} />}
      {payload.start && <Detail label={t('calendar.start')} value={payload.start} />}
      {payload.end && <Detail label={t('calendar.end')} value={payload.end} />}
      {payload.location && <Detail label={t('calendar.location')} value={payload.location} />}
      {payload.comment && <Detail label={t('calendar.description')} value={payload.comment} />}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GenericPreview({ payload }) {
  const fields = Object.entries(payload).filter(([key]) => (
    !key.endsWith('_id') && key !== 'time_zone'
  ));
  return (
    <div className="approval-details">
      {fields.map(([key, value]) => (
        <Detail key={key} label={key.replaceAll('_', ' ')} value={String(value)} />
      ))}
    </div>
  );
}

export const APPROVAL_RENDERERS = {
  email: { Preview: EmailPreview, Icon: Mail },
  email_delete: { Preview: EmailDeletePreview, Icon: Trash },
  calendar: { Preview: CalendarPreview, Icon: Calendar },
  generic: { Preview: GenericPreview, Icon: Mail },
};

export function getApprovalRenderer(action) {
  const configured = action.presentation?.renderer;
  if (configured && APPROVAL_RENDERERS[configured]) return APPROVAL_RENDERERS[configured];
  const type = action.canonical_action_type || action.action_type || '';
  if (type === 'mail.send' || type === 'send_email' || !type) return APPROVAL_RENDERERS.email;
  if (type === 'mail.move_to_trash' || type === 'delete_email') return APPROVAL_RENDERERS.email_delete;
  if (type.startsWith('calendar.')) return APPROVAL_RENDERERS.calendar;
  return APPROVAL_RENDERERS.generic;
}
