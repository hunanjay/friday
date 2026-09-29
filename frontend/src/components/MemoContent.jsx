import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MemoRichText.css';

// Render Markdown without executing stored HTML, and keep legacy single newlines.
export default function MemoContent({ content = '' }) {
  return <div className="memo-card-content memo-rich-content" onClick={e => {
    if (e.target.closest('a')) e.stopPropagation();
  }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      img: ({ alt }) => <span>{alt}</span>,
    }}>{content}</ReactMarkdown>
  </div>;
}
