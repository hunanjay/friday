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
