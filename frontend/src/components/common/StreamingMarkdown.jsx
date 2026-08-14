import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renders assistant replies as Markdown. This used to be a hand-written parser;
// it silently dropped the rest of a paragraph whenever a syntax character did
// not form a complete construct (a GitHub subject like "[org/repo] Build failed"
// was enough to lose the line). remark handles the grammar now - this file only
// supplies the chrome: a typing indicator and the code-block header.
//
// Partially streamed syntax ("**bol") renders literally for a moment and then
// snaps into place once the closing token arrives. That flicker is the tradeoff
// for never losing text again, and it only ever affects the last few tokens.

function CodeBlock({ className, children }) {
  const lang = /language-(\w+)/.exec(className || '')?.[1] || 'text';
  const source = String(children).replace(/\n$/, '');
  return (
    <div className="markdown-code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <button
          type="button"
          className="code-copy-btn"
          onClick={() => navigator.clipboard.writeText(source)}
        >
          Copy
        </button>
      </div>
      <pre className="code-block-pre">
        <code className="code-block-code">{source}</code>
      </pre>
    </div>
  );
}

const COMPONENTS = {
  p: props => <p className="markdown-p" {...props} />,
  ul: props => <ul className="markdown-ul" {...props} />,
  ol: props => <ol className="markdown-ol" {...props} />,
  li: props => <li className="markdown-li" {...props} />,
  h1: props => <h1 className="markdown-h markdown-h1" {...props} />,
  h2: props => <h2 className="markdown-h markdown-h2" {...props} />,
  h3: props => <h3 className="markdown-h markdown-h3" {...props} />,
  h4: props => <h4 className="markdown-h markdown-h4" {...props} />,
  h5: props => <h5 className="markdown-h markdown-h5" {...props} />,
  h6: props => <h6 className="markdown-h markdown-h6" {...props} />,
  a: props => <a className="markdown-link" target="_blank" rel="noopener noreferrer" {...props} />,
  // react-markdown renders fenced blocks as <pre><code>, and inline spans as a
  // bare <code>. Only the fenced form gets the language header and copy button.
  pre: props => <>{props.children}</>,
  code: ({ className, children, ...rest }) =>
    className?.startsWith('language-')
      ? <CodeBlock className={className}>{children}</CodeBlock>
      : <code className="markdown-inline-code" {...rest}>{children}</code>,
};

export default function StreamingMarkdown({ content, isBotTyping }) {
  if (!content && isBotTyping) {
    return (
      <div className="typing-bubble">
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
      </div>
    );
  }

  return (
    <div className="streaming-markdown-container">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </Markdown>
    </div>
  );
}
