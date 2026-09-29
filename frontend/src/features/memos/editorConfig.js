import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

export const memoEditorExtensions = () => [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, underline: false, link: { openOnClick: false } }),
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
];
