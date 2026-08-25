import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useContactTags, useContacts } from './hooks';

const apiMocks = vi.hoisted(() => ({
  getContactTags: vi.fn(),
  getContacts: vi.fn(),
  syncMicrosoftContacts: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  deleteContactFact: vi.fn(),
}));

vi.mock('./api', () => ({
  getContactTags: apiMocks.getContactTags,
  getContacts: apiMocks.getContacts,
  syncMicrosoftContacts: apiMocks.syncMicrosoftContacts,
  createContact: apiMocks.createContact,
  updateContact: apiMocks.updateContact,
  deleteContact: apiMocks.deleteContact,
  deleteContactFact: apiMocks.deleteContactFact,
}));

function ContactsProbe({ query = '', tag = null }) {
  const { contacts, isLoadingContacts, createContact, deleteContact, syncMicrosoftContacts } = useContacts({
    query,
    tag,
    debounceMs: 0,
  });
  return (
    <div>
      <span data-testid="contacts">{contacts.map(c => c.id).join(',')}</span>
      <span data-testid="loading">{String(isLoadingContacts)}</span>
      <button onClick={() => createContact({ name: 'Ada' })}>create</button>
      <button onClick={() => deleteContact('1')}>delete</button>
      <button onClick={() => syncMicrosoftContacts()}>sync</button>
    </div>
  );
}

function TagsProbe() {
  const { contactTags } = useContactTags();
  return <span data-testid="tags">{contactTags.join(',')}</span>;
}

function renderWithClient(children) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const auth = { authToken: 'token', user: { id: 'user-1' } };
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('contacts hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getContacts.mockResolvedValue([{ id: '1' }, { id: '2' }]);
    apiMocks.getContactTags.mockResolvedValue(['work', 'family']);
  });

  it('loads contacts for the given query and tag', async () => {
    renderWithClient(<ContactsProbe query="ada" tag="work" />);

    await waitFor(() => expect(screen.getByTestId('contacts')).toHaveTextContent('1,2'));
    expect(apiMocks.getContacts).toHaveBeenCalledWith('token', expect.objectContaining({
      query: 'ada',
      tag: 'work',
    }));
  });

  it('loads tags', async () => {
    renderWithClient(<TagsProbe />);
    await waitFor(() => expect(screen.getByTestId('tags')).toHaveTextContent('work,family'));
  });

  it('refetches the contact list after create, delete, and sync mutations', async () => {
    apiMocks.createContact.mockResolvedValue({ id: '3' });
    apiMocks.deleteContact.mockResolvedValue('1');
    apiMocks.syncMicrosoftContacts.mockResolvedValue({ created: 1, updated: 0, total: 1 });

    renderWithClient(<ContactsProbe />);
    await waitFor(() => expect(screen.getByTestId('contacts')).toHaveTextContent('1,2'));

    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(apiMocks.createContact).toHaveBeenCalledWith('token', { name: 'Ada' }));
    await waitFor(() => expect(apiMocks.getContacts).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(apiMocks.deleteContact).toHaveBeenCalledWith('token', '1'));
    await waitFor(() => expect(apiMocks.getContacts).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('button', { name: 'sync' }));
    await waitFor(() => expect(apiMocks.syncMicrosoftContacts).toHaveBeenCalledWith('token'));
    await waitFor(() => expect(apiMocks.getContacts).toHaveBeenCalledTimes(4));
  });
});
