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
