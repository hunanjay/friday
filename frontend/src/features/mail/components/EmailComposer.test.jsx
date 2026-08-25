import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailComposer } from './EmailComposer';

function composeController(overrides = {}) {
  return {
    addAttachments: vi.fn(),
    closeCompose: vi.fn(),
    composeAttachments: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
    composeBcc: '',
    composeBody: 'Body',
    composeCc: '',
    composeChannel: 'microsoft',
    composeSubject: 'Subject',
    composeTo: 'person@example.com',
    isComposing: true,
    isSending: false,
    removeAttachment: vi.fn(),
    setComposeBcc: vi.fn(),
    setComposeBody: vi.fn(),
    setComposeCc: vi.fn(),
    setComposeChannel: vi.fn(),
    setComposeSubject: vi.fn(),
    setComposeTo: vi.fn(),
    setShowCopyFields: vi.fn(),
    showCopyFields: false,
    submitCompose: vi.fn(event => event.preventDefault()),
    ...overrides,
  };
}

const t = (key, values) => values ? `${key}:${values.limit}` : key;

describe('EmailComposer', () => {
  it('renders nothing while compose is closed', () => {
    const { container } = render(
      <EmailComposer
        compose={composeController({ isComposing: false })}
        isZh={false}
        mailAccounts={[]}
        signature=""
        t={t}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('binds compose fields, accounts, attachments, and actions to its controller', () => {
    const compose = composeController();
    render(
      <EmailComposer
        compose={compose}
        isZh={false}
        mailAccounts={[{ id: 'account-1', email_address: 'bound@example.com' }]}
        signature="Best regards"
        t={t}
      />,
    );

    expect(screen.getByRole('option', { name: 'bound@example.com' })).toBeInTheDocument();
    expect(screen.getByText('Best regards')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('email.to:'), {
      target: { value: 'next@example.com' },
    });
    expect(compose.setComposeTo).toHaveBeenCalledWith('next@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'email.cc / email.bcc' }));
    expect(compose.setShowCopyFields).toHaveBeenCalledWith(true);

    const attachment = new File(['report'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Add attachment'), {
      target: { files: [attachment] },
    });
    expect(compose.addAttachments).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
    );
    const sizeMessage = compose.addAttachments.mock.calls[0][1]({ limit: 3 });
    expect(sizeMessage).toBe('email.attachmentsTooLarge:3');

    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    expect(compose.removeAttachment).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'email.send' }));
    expect(compose.submitCompose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close composer' }));
    expect(compose.closeCompose).toHaveBeenCalledOnce();
  });
});
