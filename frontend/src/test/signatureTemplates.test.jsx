import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignatureTemplates from '../components/SignatureTemplates';

const state = vi.hoisted(() => ({}));

vi.mock('../features/settings/hooks', () => ({
  useSignatures: () => state,
}));

const work = { id: 'w', name: 'Work', content: '-- Jane, Acme', is_default: true };
const personal = { id: 'p', name: 'Personal', content: '-- Jane', is_default: false };

function renderPanel(overrides = {}) {
  const showToast = vi.fn();
  Object.assign(state, {
    signatures: [work, personal],
    isLoadingSignatures: false,
    isSavingSignature: false,
    createSignature: vi.fn().mockResolvedValue({}),
    updateSignature: vi.fn().mockResolvedValue({}),
    setDefaultSignature: vi.fn().mockResolvedValue([]),
    deleteSignature: vi.fn().mockResolvedValue('w'),
  }, overrides);
  render(<SignatureTemplates isZh={false} showToast={showToast} autoEdit={overrides.autoEdit ?? false} />);
  return { ...state, showToast };
}

describe('SignatureTemplates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the default and offers to switch only the others', () => {
    renderPanel();
    expect(screen.getByText('Default')).toBeTruthy();
    // One "Use this" button: the default cannot be promoted to itself.
    expect(screen.getAllByRole('button', { name: 'Use this' })).toHaveLength(1);
  });

  it('switches the default template', async () => {
    const { setDefaultSignature, showToast } = renderPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use this' })));
    expect(setDefaultSignature).toHaveBeenCalledWith('p');
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Now signing with "Personal"/));
  });

  it('creates a new template rather than overwriting the open one', async () => {
    const { createSignature, updateSignature } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.change(screen.getByLabelText('Signature name'), { target: { value: 'Client' } });
    fireEvent.change(document.querySelector('textarea'), { target: { value: '-- J' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(createSignature).toHaveBeenCalledWith({ name: 'Client', content: '-- J' });
    expect(updateSignature).not.toHaveBeenCalled();
  });

  it('edits an existing template by id', async () => {
    const { updateSignature, createSignature } = renderPanel();
    fireEvent.click(screen.getAllByRole('button', { name: /Edit/ })[1]);
    fireEvent.change(screen.getByLabelText('Signature name'), { target: { value: 'Home' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(updateSignature).toHaveBeenCalledWith({ id: 'p', name: 'Home', content: '-- Jane' });
    expect(createSignature).not.toHaveBeenCalled();
  });

  it('refuses to save a template with no name', async () => {
    const { createSignature, showToast } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.change(screen.getByLabelText('Signature name'), { target: { value: '   ' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(createSignature).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Give the signature a name/));
  });

  it('needs a second click to delete, so one misclick cannot drop a signature', async () => {
    const { deleteSignature } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }));
    expect(deleteSignature).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })));
    expect(deleteSignature).toHaveBeenCalledWith('w');
  });

  it('opens the default for editing when the approval card links to #signature', async () => {
    renderPanel({ autoEdit: true });
    expect(screen.getByLabelText('Signature name').value).toBe('Work');
    expect(document.querySelector('textarea').value).toBe('-- Jane, Acme');
  });

  it('waits for the list before auto-editing, instead of opening a blank draft', () => {
    renderPanel({ autoEdit: true, signatures: [], isLoadingSignatures: true });
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('prompts for a first signature when there are none', () => {
    renderPanel({ signatures: [] });
    expect(screen.getByText(/No signatures yet/)).toBeTruthy();
  });
});
