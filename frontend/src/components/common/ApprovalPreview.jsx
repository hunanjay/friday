/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { Calendar, Mail, Trash } from './Icons';

/**
 * Uncontrolled on purpose: `value` is only the initial text, so typing never
 * re-renders the node and the caret stays put. `innerText` (not textContent)
 * keeps the line breaks an email body needs.
 */
function Editable({ as: Tag, value, className = '', onChange }) {
  if (!onChange) return <Tag className={className}>{value}</Tag>;
  return (
    <Tag
      className={`${className} approval-editable`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      onInput={(e) => onChange(e.currentTarget.innerText)}
    >
      {value}
    </Tag>
  );
}

function EmailPreview({ payload, action, t, onEdit }) {
  const edit = (field) => (onEdit ? (value) => onEdit(field, value) : null);
  const signature = (action?.presentation?.signature || '').trim();
  return (
    <div className="approval-email-preview">
      {/* One grid for both header rows, so the label column sizes itself to the
          widest label and the values line up in either language. */}
      <div className="approval-email-head">
        {(payload.to || onEdit) && (
          <>
            <span className="approval-email-label">{t('email.to')}</span>
            <Editable as="div" className="approval-email-to" value={payload.to} onChange={edit('to')} />
          </>
        )}
        {(payload.cc || onEdit) && (
          <>
            <span className="approval-email-label">{t('email.cc')}</span>
            <Editable as="div" className="approval-email-to" value={payload.cc} onChange={edit('cc')} />
          </>
        )}
        {(payload.subject || onEdit) && (
          <>
            <span className="approval-email-label">{t('email.subject')}</span>
            <Editable
              as="div"
              className="approval-email-subject"
              value={payload.subject}
              onChange={edit('subject')}
            />
          </>
        )}
      </div>
      {(payload.body || onEdit) && (
        <div className="approval-email-body">
          <Editable as="p" value={payload.body} onChange={edit('body')} />
          {/* Not editable and not part of the payload: the backend appends the
              saved signature at send time. Shown so the card is the whole
              email the recipient will get, not just the part the agent wrote. */}
          {signature && !payload.body?.trimEnd().endsWith(signature) && (
            <p className="approval-email-signature">{signature}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Forwarding carries the original along, so the card previews only the note. */
function EmailForwardPreview({ payload, action, t, onEdit }) {
  const edit = (field) => (onEdit ? (value) => onEdit(field, value) : null);
  const signature = (action?.presentation?.signature || '').trim();
  return (
    <div className="approval-email-preview">
      <div className="approval-email-head">
        <span className="approval-email-label">{t('email.to')}</span>
        <Editable as="div" className="approval-email-to" value={payload.to} onChange={edit('to')} />
        {(payload.cc || onEdit) && (
          <>
            <span className="approval-email-label">{t('email.cc')}</span>
            <Editable as="div" className="approval-email-to" value={payload.cc} onChange={edit('cc')} />
          </>
        )}
      </div>
      <div className="approval-email-body">
        <Editable as="p" value={payload.comment} onChange={edit('comment')} />
        {signature && !payload.comment?.trimEnd().endsWith(signature) && (
          <p className="approval-email-signature">{signature}</p>
        )}
        <p className="approval-email-note">{t('email.forwardCarriesOriginal')}</p>
      </div>
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
  email_forward: { Preview: EmailForwardPreview, Icon: Mail },
  email_delete: { Preview: EmailDeletePreview, Icon: Trash },
  calendar: { Preview: CalendarPreview, Icon: Calendar },
  generic: { Preview: GenericPreview, Icon: Mail },
};

export function getApprovalRenderer(action) {
  const configured = action.presentation?.renderer;
  if (configured && APPROVAL_RENDERERS[configured]) return APPROVAL_RENDERERS[configured];
  const type = action.canonical_action_type || action.action_type || '';
  if (type === 'mail.send' || type === 'send_email' || !type) return APPROVAL_RENDERERS.email;
  if (type === 'mail.forward' || type === 'forward_email') return APPROVAL_RENDERERS.email_forward;
  if (type === 'mail.move_to_trash' || type === 'delete_email') return APPROVAL_RENDERERS.email_delete;
  if (type.startsWith('calendar.')) return APPROVAL_RENDERERS.calendar;
  return APPROVAL_RENDERERS.generic;
}
