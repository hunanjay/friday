import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StreamingMarkdown from '../components/common/StreamingMarkdown';

// The inline parser used to `break` out of its scan loop whenever a syntax
// character did not form a complete construct, which silently dropped the rest
// of the paragraph. Email digests trip this constantly: GitHub subjects start
// with "[org/repo]", which is not a Markdown link.
describe('StreamingMarkdown inline parsing', () => {
  const renderDone = (content) =>
    render(<StreamingMarkdown content={content} isBotTyping={false} />);

  it('keeps text after a bracket that is not a link', () => {
    renderDone("Subject: '[HKU-SZRI/nexus] PR run failed: Lint - versioning (968dbe4)'");
    expect(screen.getByText(/PR run failed/)).toBeTruthy();
    expect(screen.getByText(/968dbe4/)).toBeTruthy();
  });

  it('keeps text after an unmatched asterisk', () => {
    renderDone('2 * 3 is six, and the rest of this line must survive');
    expect(screen.getByText(/rest of this line must survive/)).toBeTruthy();
  });

  it('keeps text after an unmatched backtick', () => {
    renderDone("it's a ` backtick and this tail must survive");
    expect(screen.getByText(/tail must survive/)).toBeTruthy();
  });

  it('keeps text after an unmatched double asterisk', () => {
    renderDone('a ** dangling bold marker and this tail must survive');
    expect(screen.getByText(/tail must survive/)).toBeTruthy();
  });

  it('still renders a real Markdown link', () => {
    renderDone('see [the docs](https://example.com) for details');
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(screen.getByText(/for details/)).toBeTruthy();
  });

  // Grammar the hand-written parser never supported.
  it('renders a GFM table', () => {
    renderDone('| Repo | Status |\n| --- | --- |\n| nexus | failed |');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'nexus' })).toBeTruthy();
  });

  it('renders nested emphasis', () => {
    const { container } = renderDone('**bold with *italic* inside**');
    expect(container.querySelector('strong em')).toBeTruthy();
  });

  it('honours backslash escapes', () => {
    renderDone('a literal \\*asterisk\\* stays put');
    expect(screen.getByText(/\*asterisk\*/)).toBeTruthy();
  });

  it('renders a blockquote', () => {
    const { container } = renderDone('> quoted line');
    expect(container.querySelector('blockquote')).toBeTruthy();
  });

  it('renders every line of a multi-entry email digest', () => {
    renderDone(
      "Here are your recent 2 emails:\n\n" +
      "1. From: notifications@github.com\n" +
      "   Subject: '[HKU-SZRI/nexus] PR run failed'\n" +
      "   Preview: '[HKU-SZRI/nexus] Lint workflow run'\n\n" +
      "2. From: noreply@github.com\n" +
      "   Subject: '[GitHub] Repository transfer from @dawsn0'\n"
    );
    expect(screen.getByText(/PR run failed/)).toBeTruthy();
    expect(screen.getByText(/Lint workflow run/)).toBeTruthy();
    expect(screen.getByText(/Repository transfer from @dawsn0/)).toBeTruthy();
  });
});
