import React, { useEffect, useRef, useState } from 'react';

/**
 * Component to securely and beautifully render email content.
 * Supports both HTML and Plain Text bodies.
 * Uses sandboxed iframe for HTML to isolate style scope and enforce security.
 */
export default function EmailContentRenderer({ body }) {
  const iframeRef = useRef(null);
  const [iframeHeight, setIframeHeight] = useState('200px');

  const content = body?.content || '';
  const contentType = body?.contentType || 'text';

  // Listen to theme mutations to update iframe style dynamically (Hook placed at top level)
  useEffect(() => {
    if (contentType !== 'html') return;

    const observer = new MutationObserver(() => {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        try {
          const isDark = document.documentElement.classList.contains('dark');
          const styleElement = iframe.contentWindow.document.querySelector('style');
          if (styleElement) {
            styleElement.textContent = `
              html, body {
                overflow: hidden !important;
              }
              body {
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 0.95rem;
                line-height: 1.6;
                color: ${isDark ? '#EBE8E2' : '#191919'};
                background-color: transparent;
                margin: 0;
                padding: 8px 0;
                word-break: break-word;
              }
              a {
                color: ${isDark ? '#E27E5B' : '#CC5A37'};
                text-decoration: none;
                border-bottom: 1px dotted currentColor;
                transition: border-color 0.15s ease;
              }
              a:hover {
                border-bottom-style: solid;
              }
              p {
                margin-top: 0;
                margin-bottom: 12px;
              }
              ul, ol {
                margin-top: 0;
                margin-bottom: 16px;
                padding-left: 20px;
              }
              li {
                margin-bottom: 6px;
              }
              blockquote {
                margin: 12px 0;
                padding-left: 12px;
                border-left: 3px solid ${isDark ? '#3E3E3A' : '#D0C9BE'};
                color: ${isDark ? '#AAA49C' : '#605B56'};
              }
              img {
                max-width: 100%;
                height: auto;
                border-radius: 6px;
              }
            `;
          }
        } catch {
          // Ignore style manipulation errors
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [contentType]);

  if (!body) return null;

  // HTML content rendering using a sandboxed iframe
  if (contentType === 'html') {
    const handleIframeLoad = () => {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        try {
          // Adjust height based on content
          const height = iframe.contentWindow.document.documentElement.scrollHeight;
          setIframeHeight(`${height + 30}px`);

          // Inject styling to match current theme
          const styleElement = iframe.contentWindow.document.createElement('style');
          const isDark = document.documentElement.classList.contains('dark');
          styleElement.textContent = `
            html, body {
              overflow: hidden !important;
            }
            body {
              font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 0.95rem;
              line-height: 1.6;
              color: ${isDark ? '#EBE8E2' : '#191919'};
              background-color: transparent;
              margin: 0;
              padding: 8px 0;
              word-break: break-word;
            }
            a {
              color: ${isDark ? '#E27E5B' : '#CC5A37'};
              text-decoration: none;
              border-bottom: 1px dotted currentColor;
              transition: border-color 0.15s ease;
            }
            a:hover {
              border-bottom-style: solid;
            }
            p {
              margin-top: 0;
              margin-bottom: 12px;
            }
            ul, ol {
              margin-top: 0;
              margin-bottom: 16px;
              padding-left: 20px;
            }
            li {
              margin-bottom: 6px;
            }
            blockquote {
              margin: 12px 0;
              padding-left: 12px;
              border-left: 3px solid ${isDark ? '#3E3E3A' : '#D0C9BE'};
              color: ${isDark ? '#AAA49C' : '#605B56'};
            }
            img {
              max-width: 100%;
              height: auto;
              border-radius: 6px;
            }
          `;
          iframe.contentWindow.document.head.appendChild(styleElement);
        } catch {
          // Ignore
        }
      }
    };

    return (
      <div className="email-html-renderer">
        <iframe
          ref={iframeRef}
          srcDoc={content}
          title="Email HTML Content"
          sandbox="allow-popups"
          style={{ width: '100%', height: iframeHeight, border: 'none', overflow: 'hidden' }}
          onLoad={handleIframeLoad}
        />
      </div>
    );
  }

  // Plain Text content rendering with URL parsing and clean styles
  const renderTextContent = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;

    return text.split('\n').map((line, index) => {
      if (!line.trim()) {
        return <p key={index} className="email-line-empty">&nbsp;</p>;
      }

      // Check if this line looks like a list item
      const isListItem = line.trim().startsWith('•') || line.trim().startsWith('-') || /^\d+\./.test(line.trim());
      // Check if this line is a blockquote/reply quote
      const isQuote = line.trim().startsWith('>');

      let displayLine = line;
      if (isQuote) {
        // Strip the leading '>'
        displayLine = line.trim().substring(1).trim();
      }

      const parts = displayLine.split(urlRegex);
      const contentWithLinks = parts.map((part, i) => {
        if (urlRegex.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="email-body-link">
              {part}
            </a>
          );
        }
        return part;
      });

      if (isQuote) {
        return (
          <blockquote key={index} className="email-body-blockquote">
            {contentWithLinks}
          </blockquote>
        );
      }

      return (
        <p key={index} className={isListItem ? 'email-line-list-item' : 'email-line-text'}>
          {contentWithLinks}
        </p>
      );
    });
  };

  return (
    <div className="email-text-renderer">
      {renderTextContent(content)}
    </div>
  );
}
