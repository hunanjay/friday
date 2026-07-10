import React, { useMemo, useRef } from 'react';

// Block parser that parses markdown text into semantic blocks
function textToBlocks(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks = [];
  let currentBlock = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we are inside a code block
    if (currentBlock && currentBlock.type === 'code') {
      if (line.startsWith('```')) {
        currentBlock.completed = true;
        blocks.push(currentBlock);
        currentBlock = null;
      } else {
        currentBlock.text += (currentBlock.text ? '\n' : '') + line;
      }
      continue;
    }

    // Check if starting a code block
    if (line.startsWith('```')) {
      if (currentBlock) {
        currentBlock.completed = true;
        blocks.push(currentBlock);
      }
      const lang = line.slice(3).trim();
      currentBlock = {
        type: 'code',
        lang: lang || 'text',
        text: '',
        completed: false
      };
      continue;
    }

    // Check for headers
    if (line.startsWith('#')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        if (currentBlock) {
          currentBlock.completed = true;
          blocks.push(currentBlock);
        }
        blocks.push({
          type: 'header',
          level: match[1].length,
          text: match[2],
          completed: true
        });
        currentBlock = null;
        continue;
      }
    }

    // Check for list items (unordered)
    const listMatch = line.match(/^(\s*)(-\s+|\*\s+|\+\s+)(.*)$/);
    if (listMatch) {
      if (currentBlock && currentBlock.type !== 'list') {
        currentBlock.completed = true;
        blocks.push(currentBlock);
        currentBlock = null;
      }

      if (!currentBlock) {
        currentBlock = {
          type: 'list',
          items: [],
          completed: false
        };
      }
      currentBlock.items.push(listMatch[3]);
      continue;
    }

    // Check for numbered list items
    const numListMatch = line.match(/^(\s*)(\d+\.\s+)(.*)$/);
    if (numListMatch) {
      if (currentBlock && currentBlock.type !== 'num-list') {
        currentBlock.completed = true;
        blocks.push(currentBlock);
        currentBlock = null;
      }

      if (!currentBlock) {
        currentBlock = {
          type: 'num-list',
          items: [],
          completed: false
        };
      }
      currentBlock.items.push(numListMatch[3]);
      continue;
    }

    // Empty line separates paragraphs
    if (line.trim() === '') {
      if (currentBlock) {
        currentBlock.completed = true;
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Default: append to paragraph
    if (!currentBlock) {
      currentBlock = {
        type: 'paragraph',
        text: line,
        completed: false
      };
    } else if (currentBlock.type === 'paragraph') {
      currentBlock.text += '\n' + line;
    } else {
      // If we change type, push old one
      currentBlock.completed = true;
      blocks.push(currentBlock);
      currentBlock = {
        type: 'paragraph',
        text: line,
        completed: false
      };
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

// Inline parser that implements the Token Buffering (anti-flicker) mechanism
// If a token (e.g. **, *, `, [) is not closed at the end of streaming,
// we buffer it or display it without the raw syntax characters, keeping UI clean.
function parseInlineWithBuffer(text, isLastBlockAndStreaming) {
  if (!text) return '';
  const elements = [];
  let i = 0;

  while (i < text.length) {
    // 1. Bold (**)
    if (text.startsWith('**', i)) {
      const closeIndex = text.indexOf('**', i + 2);
      if (closeIndex !== -1) {
        elements.push(
          <strong key={`bold-${i}`}>
            {parseInlineWithBuffer(text.slice(i + 2, closeIndex), false)}
          </strong>
        );
        i = closeIndex + 2;
      } else {
        // Unclosed '**'
        if (isLastBlockAndStreaming) {
          // Swallow the '**' syntax characters and render the text in a fading state
          elements.push(
            <span key={`bold-inc-${i}`} className="markdown-token-incomplete markdown-bold-incomplete">
              {parseInlineWithBuffer(text.slice(i + 2), false)}
            </span>
          );
        } else {
          elements.push('**');
          i += 2;
        }
        break; // Reached end of text
      }
    }
    // 2. Italic (*)
    else if (text.startsWith('*', i)) {
      const closeIndex = text.indexOf('*', i + 1);
      if (closeIndex !== -1) {
        elements.push(
          <em key={`italic-${i}`}>
            {parseInlineWithBuffer(text.slice(i + 1, closeIndex), false)}
          </em>
        );
        i = closeIndex + 1;
      } else {
        // Unclosed '*'
        if (isLastBlockAndStreaming) {
          // Swallow '*' syntax character and render text as incomplete italic
          elements.push(
            <span key={`italic-inc-${i}`} className="markdown-token-incomplete markdown-italic-incomplete">
              {parseInlineWithBuffer(text.slice(i + 1), false)}
            </span>
          );
        } else {
          elements.push('*');
          i += 1;
        }
        break;
      }
    }
    // 3. Inline code (`)
    else if (text.startsWith('`', i)) {
      const closeIndex = text.indexOf('`', i + 1);
      if (closeIndex !== -1) {
        elements.push(
          <code key={`code-${i}`} className="markdown-inline-code">
            {text.slice(i + 1, closeIndex)}
          </code>
        );
        i = closeIndex + 1;
      } else {
        // Unclosed '`'
        if (isLastBlockAndStreaming) {
          // Swallow '`' syntax character and render in partial code style
          elements.push(
            <code key={`code-inc-${i}`} className="markdown-inline-code-incomplete">
              {text.slice(i + 1)}
            </code>
          );
        } else {
          elements.push('`');
          i += 1;
        }
        break;
      }
    }
    // 4. Link [text](url)
    else if (text.startsWith('[', i)) {
      const closeBrackIndex = text.indexOf(']', i + 1);
      if (closeBrackIndex !== -1) {
        if (text.startsWith('(', closeBrackIndex + 1)) {
          const closeParenIndex = text.indexOf(')', closeBrackIndex + 2);
          if (closeParenIndex !== -1) {
            const linkText = text.slice(i + 1, closeBrackIndex);
            const linkUrl = text.slice(closeBrackIndex + 2, closeParenIndex);
            elements.push(
              <a key={`link-${i}`} href={linkUrl} target="_blank" rel="noopener noreferrer" className="markdown-link">
                {linkText}
              </a>
            );
            i = closeParenIndex + 1;
            continue;
          }
        }
      }

      // Unclosed or invalid link bracket
      if (isLastBlockAndStreaming) {
        elements.push(
          <span key={`link-inc-${i}`} className="markdown-token-incomplete markdown-link-incomplete">
            {parseInlineWithBuffer(text.slice(i + 1), false)}
          </span>
        );
      } else {
        elements.push('[');
        i += 1;
      }
      break;
    }
    // 5. Standard plain character
    else {
      elements.push(text[i]);
      i += 1;
    }
  }

  return elements;
}

export default function StreamingMarkdown({ content, isBotTyping }) {
  const blocks = useMemo(() => textToBlocks(content), [content]);
  const cacheRef = useRef({}); // index_type -> { serializedBlock, jsx }

  if (blocks.length === 0 && isBotTyping) {
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
      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        const cacheKey = `${idx}_${block.type}`;
        const serializedBlock = JSON.stringify(block);

        // Incremental Parser: Cache hit if block is completed and matches cached version
        if (
          block.completed &&
          cacheRef.current[cacheKey] &&
          cacheRef.current[cacheKey].serializedBlock === serializedBlock
        ) {
          return cacheRef.current[cacheKey].jsx;
        }

        // Otherwise, render block dynamically
        const isLastBlockAndStreaming = isLast && isBotTyping;
        let renderedJsx;

        if (block.type === 'paragraph') {
          renderedJsx = (
            <p key={idx} className="markdown-p">
              {parseInlineWithBuffer(block.text, isLastBlockAndStreaming)}
            </p>
          );
        } else if (block.type === 'header') {
          const HeaderTag = `h${block.level}`;
          renderedJsx = (
            <HeaderTag key={idx} className={`markdown-h markdown-h${block.level}`}>
              {parseInlineWithBuffer(block.text, false)}
            </HeaderTag>
          );
        } else if (block.type === 'list') {
          renderedJsx = (
            <ul key={idx} className="markdown-ul">
              {block.items.map((item, i) => (
                <li key={i} className="markdown-li">
                  {parseInlineWithBuffer(
                    item,
                    isLastBlockAndStreaming && i === block.items.length - 1
                  )}
                </li>
              ))}
            </ul>
          );
        } else if (block.type === 'num-list') {
          renderedJsx = (
            <ol key={idx} className="markdown-ol">
              {block.items.map((item, i) => (
                <li key={i} className="markdown-li">
                  {parseInlineWithBuffer(
                    item,
                    isLastBlockAndStreaming && i === block.items.length - 1
                  )}
                </li>
              ))}
            </ol>
          );
        } else if (block.type === 'code') {
          // Token Buffering for Code Blocks: we omit the ``` markers entirely in UI
          renderedJsx = (
            <div key={idx} className="markdown-code-block">
              <div className="code-block-header">
                <span className="code-block-lang">{block.lang}</span>
                <button
                  type="button"
                  className="code-copy-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(block.text);
                  }}
                >
                  Copy
                </button>
              </div>
              <pre className="code-block-pre">
                <code className="code-block-code">{block.text}</code>
              </pre>
            </div>
          );
        }

        // Cache the rendered JSX if block is completed so we never re-evaluate it again
        if (block.completed) {
          cacheRef.current[cacheKey] = {
            serializedBlock,
            jsx: renderedJsx
          };
        }

        return renderedJsx;
      })}
    </div>
  );
}
