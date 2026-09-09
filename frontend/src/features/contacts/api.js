import { apiRequest } from '../../api/client';

export async function getContactTags(token) {
  const data = await apiRequest('/api/contacts/tags', { token });
  return Array.isArray(data) ? data : [];
}

export async function getContacts(token, { query = '', tag = null, signal } = {}) {
  const data = await apiRequest('/api/contacts', {
    token,
    signal,
    query: { query: query || undefined, tag: tag || undefined },
  });
  return Array.isArray(data) ? data : [];
}

export function syncMicrosoftContacts(token) {
  return apiRequest('/api/contacts/sync/microsoft', { method: 'POST', token });
}

export function createContact(token, contact) {
  return apiRequest('/api/contacts', { method: 'POST', token, body: contact });
}

export function updateContact(token, contactId, patch) {
  return apiRequest(`/api/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    token,
    body: patch,
  });
}

export async function deleteContact(token, contactId) {
  await apiRequest(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE', token });
  return contactId;
}

export function uploadContactAvatar(token, contactId, file) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest(`/api/contacts/${encodeURIComponent(contactId)}/avatar`, {
    method: 'POST',
    token,
    body,
  });
}

export function deleteContactAvatar(token, contactId) {
  return apiRequest(`/api/contacts/${encodeURIComponent(contactId)}/avatar`, { method: 'DELETE', token });
}

export async function getSelfMemory(token) {
  return apiRequest('/api/contacts/me', { token });
}

export async function deleteContactFact(token, contactId, factId) {
  await apiRequest(`/api/contacts/${encodeURIComponent(contactId)}/facts/${encodeURIComponent(factId)}`, {
    method: 'DELETE',
    token,
  });
  return factId;
}

export async function getContactReminders(token, { status = null, contactId = null, signal } = {}) {
  const data = await apiRequest('/api/contacts/reminders', {
    token,
    signal,
    query: { status: status || undefined, contact_id: contactId || undefined },
  });
  return Array.isArray(data) ? data : [];
}

export function createContactReminder(token, contactId, { dueAt, reason, suggestedAction = '' }) {
  return apiRequest(`/api/contacts/${encodeURIComponent(contactId)}/reminders`, {
    method: 'POST',
    token,
    body: { due_at: dueAt, reason, suggested_action: suggestedAction },
  });
}

export function updateContactReminder(token, reminderId, { status, snoozeUntil = null, reason, dueAt, suggestedAction } = {}) {
  return apiRequest(`/api/contacts/reminders/${encodeURIComponent(reminderId)}`, {
    method: 'PATCH',
    token,
    body: {
      status: status || undefined,
      snooze_until: snoozeUntil,
      reason,
      due_at: dueAt,
      suggested_action: suggestedAction,
    },
  });
}

export async function deleteContactReminder(token, reminderId) {
  await apiRequest(`/api/contacts/reminders/${encodeURIComponent(reminderId)}`, { method: 'DELETE', token });
  return reminderId;
}
