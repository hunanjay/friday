import React from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { memoEditorExtensions } from '../features/memos/editorConfig';
import {
  TextBold20Regular, TextItalic20Regular, TextStrikethrough20Regular,
  TextHeader220Regular, TextBulletListLtr20Regular, TextNumberListLtr20Regular,
  TextQuote20Regular, Code20Regular, ArrowUndo20Regular, ArrowRedo20Regular,
} from '@fluentui/react-icons';
import './MemoRichText.css';

export default function MemoEditor({ value = '', onChange, placeholder, isZh = false }) {
  const editor = useEditor({
    extensions: memoEditorExtensions(),
    content: value,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'memo-rich-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder || (isZh ? '便签正文' : 'Memo content') } },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getMarkdown()),
  });
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), strike: editor.isActive('strike'),
    heading: editor.isActive('heading', { level: 2 }), bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'), blockquote: editor.isActive('blockquote'), codeBlock: editor.isActive('codeBlock'),
    undo: editor.can().undo(), redo: editor.can().redo(), empty: editor.isEmpty,
  } : {} });

  const tools = [
    ['bold', TextBold20Regular, '加粗', 'Bold', () => editor.chain().focus().toggleBold().run()],
    ['italic', TextItalic20Regular, '斜体', 'Italic', () => editor.chain().focus().toggleItalic().run()],
    ['strike', TextStrikethrough20Regular, '删除线', 'Strikethrough', () => editor.chain().focus().toggleStrike().run()],
    ['heading', TextHeader220Regular, '标题', 'Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
    ['bulletList', TextBulletListLtr20Regular, '项目列表', 'Bullet list', () => editor.chain().focus().toggleBulletList().run()],
    ['orderedList', TextNumberListLtr20Regular, '编号列表', 'Numbered list', () => editor.chain().focus().toggleOrderedList().run()],
    ['blockquote', TextQuote20Regular, '引用', 'Quote', () => editor.chain().focus().toggleBlockquote().run()],
    ['codeBlock', Code20Regular, '代码块', 'Code block', () => editor.chain().focus().toggleCodeBlock().run()],
  ];

  return <div className="memo-editor">
    <div className="memo-editor-toolbar" role="toolbar" aria-label={isZh ? '文字格式' : 'Text formatting'}>
      {tools.map(([key, Icon, zh, en, action]) => <button key={key} type="button" title={isZh ? zh : en}
        aria-label={isZh ? zh : en} aria-pressed={Boolean(state?.[key])} disabled={!editor}
        onMouseDown={e => e.preventDefault()} onClick={action}><Icon /></button>)}
      <span className="memo-toolbar-divider" />
      {[[ArrowUndo20Regular, '撤销', 'Undo', 'undo'], [ArrowRedo20Regular, '重做', 'Redo', 'redo']].map(([Icon, zh, en, command]) =>
        <button key={command} type="button" title={isZh ? zh : en} aria-label={isZh ? zh : en}
          disabled={!state?.[command]} onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus()[command]().run()}><Icon /></button>)}
    </div>
    <div className="memo-editor-body">
      {state?.empty && <span className="memo-editor-placeholder">{placeholder}</span>}
      <EditorContent editor={editor} />
    </div>
    <div className="memo-editor-hint">{isZh ? 'Enter 分段 · Shift + Enter 换行' : 'Enter for a paragraph · Shift + Enter for a line break'}</div>
  </div>;
}
