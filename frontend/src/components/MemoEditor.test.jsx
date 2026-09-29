import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { memoEditorExtensions } from '../features/memos/editorConfig';
import MemoContent from './MemoContent';
import MemoEditor from './MemoEditor';

describe('memo rich text persistence', () => {
  it('mounts the lazy editor in React StrictMode', async () => {
    render(<React.StrictMode><MemoEditor value="第一行\n第二行" onChange={() => {}} placeholder="便签正文" isZh /></React.StrictMode>);
    expect(await screen.findByRole('textbox', { name: '便签正文' }, { timeout: 5000 })).toHaveTextContent('第一行');
    expect(screen.getByRole('button', { name: '加粗' })).toBeEnabled();
    cleanup();
  });
  it('preserves legacy single newlines in the editor and card', () => {
    const editor = new Editor({ extensions: memoEditorExtensions(), content: '第一行\n第二行\n\n第三段', contentType: 'markdown' });
    expect(editor.getHTML()).toContain('第一行<br>第二行');
    const saved = editor.getMarkdown();
    editor.commands.setContent(saved, { contentType: 'markdown' });
    expect(editor.getHTML()).toContain('第一行<br>第二行');
    render(<MemoContent content={saved} />);
    expect(screen.getByText(/第一行/).textContent).toContain('第二行');
    cleanup();
    editor.destroy();
  });

  it('round trips headings, formatting, lists, quotes and code', () => {
    const editor = new Editor({ extensions: memoEditorExtensions(), content: '## 标题\n\n**重点**和*斜体*\n\n- 第一项\n- 第二项\n\n> 引用\n\n```js\nconst x = 1\n```', contentType: 'markdown' });
    const html = editor.getHTML();
    editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' });
    expect(editor.getHTML().replace(/<p><\/p>$/, '')).toBe(html.replace(/<p><\/p>$/, ''));
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
    editor.destroy();
  });

  it('does not execute HTML or javascript links in stored notes', () => {
    const { container } = render(<MemoContent content={'<script>alert(1)</script>\n\n[链接](javascript:alert%281%29)\n\n**正文**'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href') || '').not.toMatch(/^javascript:/);
    expect(screen.getByText('正文').tagName).toBe('STRONG');
    cleanup();
  });

  it('keeps existing tables and checked tasks when saving', () => {
    const editor = new Editor({ extensions: memoEditorExtensions(), content: '| 项目 | 状态 |\n| --- | --- |\n| 便签 | 完成 |\n\n- [x] 已完成\n- [ ] 待处理', contentType: 'markdown' });
    const saved = editor.getMarkdown();
    editor.commands.setContent(saved, { contentType: 'markdown' });
    expect(editor.getHTML()).toContain('<table');
    expect(editor.getHTML()).toContain('便签');
    expect(editor.getHTML()).toContain('data-checked="true"');
    expect(editor.getHTML()).toContain('data-checked="false"');
    editor.destroy();
  });
});
