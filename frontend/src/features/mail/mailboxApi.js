import { apiRequest } from '../../api/client';

export const MICROSOFT_MAIL_CHANNEL = 'microsoft';

export function mailChannelPath(channel) {
  return channel === MICROSOFT_MAIL_CHANNEL
    ? '/api/graph/mail'
    : `/api/mail-accounts/${encodeURIComponent(channel)}/mail`;
}

export function normalizeMailMessage(message, parentFolderId) {
  const channel = message.provider === 'imap' && message.id?.startsWith('imap:')
    ? message.id.split(':')[1]
    : MICROSOFT_MAIL_CHANNEL;
  return {
    id: message.id,
    provider: channel,
    subject: message.subject,
    bodyPreview: message.bodyPreview,
    sender: message.sender,
    toRecipients: message.toRecipients,
    receivedDateTime: message.receivedDateTime,
    isRead: message.isRead,
    parentFolderId,
    conversationId: message.conversationId || null,
    hasAttachments: Boolean(message.hasAttachments),
  };
}

export function getMailFolderPage(token, { channel, folder, cursor }) {
  return apiRequest(`${mailChannelPath(channel)}/${encodeURIComponent(folder)}`, {
    token,
    query: cursor ? { cursor } : undefined,
  });
}

export function searchMailPage(token, {
  channel,
  cursor,
  folder,
  query,
  signal,
  top = 25,
}) {
  return apiRequest(`${mailChannelPath(channel)}/search`, {
    token,
    signal,
    query: cursor ? { cursor } : { query, folder, top },
  });
}

function mailMessagePath(messageId, suffix = '') {
  const providerPath = String(messageId).startsWith('imap:') ? 'mail' : 'graph/mail';
  return `/api/${providerPath}/${encodeURIComponent(messageId)}${suffix}`;
}

export function getMailThreadResource(threadRow) {
  const channel = threadRow.provider || MICROSOFT_MAIL_CHANNEL;
  if (threadRow.conversationId) {
    return {
      key: `conversation:${channel}:${threadRow.conversationId}`,
      path: `${mailChannelPath(channel)}/conversation/${encodeURIComponent(threadRow.conversationId)}`,
      isConversation: true,
    };
  }
  return {
    key: `message:${channel}:${threadRow.id}`,
    path: mailMessagePath(threadRow.id),
    isConversation: false,
  };
}

export async function getMailThread(token, threadRow) {
  const resource = getMailThreadResource(threadRow);
  const data = await apiRequest(resource.path, { token });
  return resource.isConversation ? (data?.value || []) : [data];
}

export function getMailMessage(token, messageId) {
  return apiRequest(mailMessagePath(messageId), { token });
}

export function markMailMessageRead(token, messageId, isRead = true) {
  return apiRequest(mailMessagePath(messageId, '/read'), {
    method: 'PATCH',
    token,
    body: { is_read: isRead },
  });
}

function composeFormData({
  attachments = [],
  bcc = '',
  body = '',
  cc = '',
  replyAll = false,
  subject = '',
  to = '',
}) {
  const formData = new FormData();
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('body', body);
  formData.append('cc', cc);
  formData.append('bcc', bcc);
  if (replyAll) formData.append('reply_all', 'true');
  attachments.forEach(file => formData.append('attachments', file));
  return formData;
}

export function saveMicrosoftDraft(token, { draftId, ...fields }) {
  const path = draftId
    ? `${mailChannelPath(MICROSOFT_MAIL_CHANNEL)}/drafts/${encodeURIComponent(draftId)}`
    : `${mailChannelPath(MICROSOFT_MAIL_CHANNEL)}/drafts`;
  return apiRequest(path, {
    method: draftId ? 'PATCH' : 'POST',
    token,
    body: composeFormData(fields),
  });
}

export function sendMail(token, {
  channel = MICROSOFT_MAIL_CHANNEL,
  messageId,
  mode,
  ...fields
}) {
  const path = messageId
    ? mailMessagePath(messageId, mode === 'forward' ? '/forward' : '/reply')
    : `${mailChannelPath(channel)}/send`;
  return apiRequest(path, {
    method: 'POST',
    token,
    body: composeFormData({ ...fields, replyAll: mode === 'replyAll' }),
  });
}

export function deleteMailMessage(token, messageId, { permanent = false } = {}) {
  return apiRequest(mailMessagePath(messageId), {
    method: 'DELETE',
    token,
    query: permanent ? { permanent: true } : undefined,
  });
}

export async function getInboxUnread(token, accountIds) {
  const requests = [
    apiRequest('/api/graph/mail/folders/inbox', { token }),
    ...accountIds.map(accountId => (
      apiRequest(`/api/mail-accounts/${accountId}/mail/folders/inbox`, { token })
    )),
  ];
  const counts = await Promise.all(requests.map(request => request.catch(() => null)));
  return counts.reduce((total, count) => total + (count?.unread || 0), 0);
}
