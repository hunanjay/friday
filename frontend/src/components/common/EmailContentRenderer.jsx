import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

const INJECTED_STYLE_ATTRIBUTE = 'data-email-content-renderer-style';
const MAX_IFRAME_WIDTH = 2400;
const API_URL = import.meta.env.VITE_API_URL || '';
const INLINE_IMAGE_CACHE_MAX_ENTRIES = 40;
const INLINE_IMAGE_CACHE_MAX_BYTES = 20 * 1024 * 1024;
const inlineImageCache = new Map();
const inlineImageRequests = new Map();
let inlineImageCacheBytes = 0;

const normalizeContentId = (value) => String(value || '')
  .trim()
  .replace(/^cid:/i, '')
  .replace(/^<|>$/g, '')
  .toLowerCase();

const sanitizeEmailHtml = (html) => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  .replace(/<script\b[^>]*\/\s*>/gi, '')
  .replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '')
  .replace(/\s(?:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, '');

const sanitizeIframeDocument = (doc) => {
  doc.querySelectorAll('script, noscript, object, embed').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attribute => {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    });
  });
  doc.querySelectorAll('[href], [src]').forEach(node => {
    ['href', 'src'].forEach(attributeName => {
      const value = node.getAttribute(attributeName);
      if (value && /^(?:javascript|data):/i.test(value.trim())) {
        node.removeAttribute(attributeName);
      }
    });
  });
};

const loadInlineImage = (messageId, attachmentId, authToken) => {
  const key = `${messageId}:${attachmentId}`;
  if (inlineImageCache.has(key)) return Promise.resolve(inlineImageCache.get(key));
  const existingRequest = inlineImageRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = fetch(
    `${API_URL}/api/graph/mail/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  )
    .then(response => {
      if (!response.ok) throw new Error(`Failed to load inline image (${response.status})`);
      return response.blob();
    })
    .then(blob => {
      if (blob.size <= INLINE_IMAGE_CACHE_MAX_BYTES) {
        while (
          inlineImageCache.size >= INLINE_IMAGE_CACHE_MAX_ENTRIES
          || inlineImageCacheBytes + blob.size > INLINE_IMAGE_CACHE_MAX_BYTES
        ) {
          const oldestKey = inlineImageCache.keys().next().value;
          if (oldestKey === undefined) break;
          inlineImageCacheBytes -= inlineImageCache.get(oldestKey).size;
          inlineImageCache.delete(oldestKey);
        }
        inlineImageCache.set(key, blob);
        inlineImageCacheBytes += blob.size;
      }
      return blob;
    })
    .finally(() => inlineImageRequests.delete(key));

  inlineImageRequests.set(key, request);
  return request;
};

const withDefaultLinkTarget = (html) => {
  const baseTag = '<base target="_blank" rel="noopener noreferrer">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${baseTag}</head>`);
  }
  return `${baseTag}${html}`;
};

const getInjectStyle = (isDark) => `
  html, body {
    width: 100% !important;
    min-width: 100% !important;
    margin: 0 !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    box-sizing: border-box !important;
  }
  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.95rem;
    line-height: 1.6;
    color: ${isDark ? '#EBE8E2' : '#191919'};
    background-color: transparent;
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

/**
 * Component to securely and beautifully render email content.
 * Supports both HTML and Plain Text bodies.
 * Uses sandboxed iframe for HTML to isolate style scope and enforce security.
 */
export default function EmailContentRenderer({ body, messageId, authToken, inlineAttachments = [] }) {
  const iframeRef = useRef(null);
  const injectedStyleRef = useRef(null);
  const resizeFrameRef = useRef(null);
  const resourceCleanupRef = useRef(null);
  const inlineObjectUrlsRef = useRef([]);
  const [iframeHeight, setIframeHeight] = useState('200px');
  const [iframeWidth, setIframeWidth] = useState('100%');
  const [resolvedContent, setResolvedContent] = useState('');
  const [inlineImagesLoading, setInlineImagesLoading] = useState(false);

  const content = body?.content || '';
  const contentType = (body?.contentType || 'text').toLowerCase();
  const iframeSrcDoc = useMemo(
    () => withDefaultLinkTarget(sanitizeEmailHtml(resolvedContent)),
    [resolvedContent]
  );

  // Outlook embeds inline images as cid: references. Resolve only the CIDs
  // actually used by this body, then replace them with local blob URLs so the
  // sandboxed iframe can display them without exposing the bearer token.
  useEffect(() => {
    let cancelled = false;
    const releaseCurrentUrls = () => {
      inlineObjectUrlsRef.current.forEach(url => window.URL.revokeObjectURL(url));
      inlineObjectUrlsRef.current = [];
    };

    if (contentType !== 'html' || !messageId || !authToken) {
      releaseCurrentUrls();
      setInlineImagesLoading(false);
      setResolvedContent(content);
      return () => { cancelled = true; };
    }

    const attachmentByContentId = new Map(
      (inlineAttachments || [])
        .filter(attachment => attachment.isInline && attachment.contentId)
        .map(attachment => [normalizeContentId(attachment.contentId), attachment])
    );
    const referencedIds = new Set();
    const cidPattern = /cid:([^"'\s>]+)/gi;
    let match;
    while ((match = cidPattern.exec(content)) !== null) {
      const normalizedId = normalizeContentId(match[1]);
      if (attachmentByContentId.has(normalizedId)) referencedIds.add(normalizedId);
    }

    if (referencedIds.size === 0) {
      releaseCurrentUrls();
      setInlineImagesLoading(false);
      setResolvedContent(content);
      return () => { cancelled = true; };
    }

    const missingIds = [...referencedIds].filter(contentId => {
      const attachment = attachmentByContentId.get(contentId);
      return !inlineImageCache.has(`${messageId}:${attachment.id}`);
    });
    setInlineImagesLoading(missingIds.length > 0);
    const fetchedUrls = [];
    Promise.all([...referencedIds].map(async contentId => {
      const attachment = attachmentByContentId.get(contentId);
      const blob = await loadInlineImage(messageId, attachment.id, authToken);
      const url = window.URL.createObjectURL(blob);
      fetchedUrls.push(url);
      return [contentId, url];
    }))
      .then(replacements => {
        if (cancelled) {
          fetchedUrls.forEach(url => window.URL.revokeObjectURL(url));
          return;
        }
        const replacementMap = new Map(replacements);
        const resolved = content.replace(cidPattern, (original, rawId) => (
          replacementMap.get(normalizeContentId(rawId)) || original
        ));
        releaseCurrentUrls();
        inlineObjectUrlsRef.current = fetchedUrls;
        setInlineImagesLoading(false);
        setResolvedContent(resolved);
      })
      .catch(() => {
        fetchedUrls.forEach(url => window.URL.revokeObjectURL(url));
        if (!cancelled) {
          setInlineImagesLoading(false);
          setResolvedContent(content);
        }
      });

    return () => { cancelled = true; };
  }, [content, contentType, messageId, authToken, inlineAttachments]);

  const applyInjectedStyle = useCallback((doc, isDark) => {
    let styleElement = injectedStyleRef.current;
    if (!styleElement || styleElement.ownerDocument !== doc || !styleElement.isConnected) {
      styleElement = doc.createElement('style');
      styleElement.setAttribute(INJECTED_STYLE_ATTRIBUTE, '');
      (doc.head || doc.documentElement).appendChild(styleElement);
      injectedStyleRef.current = styleElement;
    }
    styleElement.textContent = getInjectStyle(isDark);
  }, []);

  const updateDimensions = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    try {
      const doc = iframe.contentWindow.document;
      if (!doc || !doc.documentElement || !doc.body) return;

      const containerW = iframe.parentElement ? iframe.parentElement.clientWidth : 0;
      if (containerW <= 0) return;

      // Always measure overflow from the container width. Measuring from an
      // already-expanded iframe makes percentage-based email layouts grow on
      // every pass (for example, width: 100% plus padding).
      iframe.style.width = `${containerW}px`;
      const contentWidth = Math.max(doc.documentElement.scrollWidth || 0, doc.body.scrollWidth || 0);
      const maxWidth = Math.max(containerW, MAX_IFRAME_WIDTH);
      const measuredWidth = Math.min(Math.max(contentWidth, containerW), maxWidth);
      const nextWidth = measuredWidth > containerW ? `${Math.ceil(measuredWidth)}px` : '100%';
      iframe.style.width = nextWidth;
      setIframeWidth(currentWidth => currentWidth === nextWidth ? currentWidth : nextWidth);

      // Collapse the viewport before reading scrollHeight so the current
      // iframe height is not mistaken for content height and repeatedly added
      // back through the parent ResizeObserver.
      iframe.style.height = '0px';
      const contentHeight = Math.max(
        doc.documentElement.scrollHeight || 0,
        doc.body.scrollHeight || 0,
        doc.documentElement.offsetHeight || 0,
        doc.body.offsetHeight || 0
      );
      const nextHeight = `${Math.max(1, Math.ceil(contentHeight))}px`;
      iframe.style.height = nextHeight;
      setIframeHeight(currentHeight => currentHeight === nextHeight ? currentHeight : nextHeight);
    } catch {
      // Ignore cross-origin issues
    }
  }, []);

  // Coalesce image loads, theme changes, and container resizes into one
  // measurement per animation frame instead of forcing layout repeatedly.
  const scheduleDimensionUpdate = useCallback(() => {
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      updateDimensions();
    });
  }, [updateDimensions]);

  const observeIframeContent = useCallback((doc) => {
    if (resourceCleanupRef.current) {
      resourceCleanupRef.current();
    }

    const handleResourceLoad = (event) => {
      if (event.target instanceof doc.defaultView.HTMLImageElement) {
        scheduleDimensionUpdate();
      }
    };
    doc.addEventListener('load', handleResourceLoad, true);

    resourceCleanupRef.current = () => {
      doc.removeEventListener('load', handleResourceLoad, true);
      resourceCleanupRef.current = null;
    };

    if (doc.fonts?.ready) {
      doc.fonts.ready.then(() => {
        if (iframeRef.current?.contentWindow?.document === doc) {
          scheduleDimensionUpdate();
        }
      });
    }
  }, [scheduleDimensionUpdate]);

  // Listen to theme mutations to update iframe style dynamically
  useEffect(() => {
    if (contentType !== 'html') return;

    const observer = new MutationObserver(() => {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        try {
          const isDark = document.documentElement.classList.contains('dark');
          applyInjectedStyle(iframe.contentWindow.document, isDark);
          scheduleDimensionUpdate();
        } catch {
          // Ignore style manipulation errors
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [contentType, applyInjectedStyle, scheduleDimensionUpdate]);

  // Recalculate dimensions on window/container resize
  useEffect(() => {
    if (contentType !== 'html') return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.parentElement) return;

    let resizeObserver;
    try {
      let previousWidth = iframe.parentElement.clientWidth;
      resizeObserver = new ResizeObserver((entries) => {
        const nextWidth = entries[0]?.contentRect.width;
        if (nextWidth !== previousWidth) {
          previousWidth = nextWidth;
          scheduleDimensionUpdate();
        }
      });
      resizeObserver.observe(iframe.parentElement);
    } catch {
      // Fallback
    }

    window.addEventListener('resize', scheduleDimensionUpdate);
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleDimensionUpdate);
    };
  }, [contentType, scheduleDimensionUpdate]);

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    if (resourceCleanupRef.current) {
      resourceCleanupRef.current();
    }
    inlineObjectUrlsRef.current.forEach(url => window.URL.revokeObjectURL(url));
    inlineObjectUrlsRef.current = [];
  }, []);

  if (!body) return null;

  // HTML content rendering using a sandboxed iframe
  if (contentType === 'html') {
    if (inlineImagesLoading) {
      return (
        <div
          className="email-content-skeleton"
          role="status"
          aria-label="Loading email content"
          style={{ padding: '8px 0' }}
        >
          <div className="skeleton-box" style={{ width: '42%', height: '16px', marginBottom: '14px', borderRadius: '4px' }} />
          <div className="skeleton-box" style={{ width: '100%', height: '14px', marginBottom: '9px', borderRadius: '4px' }} />
          <div className="skeleton-box" style={{ width: '92%', height: '14px', marginBottom: '9px', borderRadius: '4px' }} />
          <div className="skeleton-box" style={{ width: '76%', height: '120px', margin: '18px 0', borderRadius: '8px' }} />
          <div className="skeleton-box" style={{ width: '88%', height: '14px', marginBottom: '9px', borderRadius: '4px' }} />
          <div className="skeleton-box" style={{ width: '64%', height: '14px', borderRadius: '4px' }} />
        </div>
      );
    }

    const handleIframeLoad = () => {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        try {
          const doc = iframe.contentWindow.document;
          sanitizeIframeDocument(doc);
          const isDark = document.documentElement.classList.contains('dark');
          applyInjectedStyle(doc, isDark);
          observeIframeContent(doc);
          scheduleDimensionUpdate();
        } catch {
          // Ignore
        }
      }
    };

    return (
      <div className="email-html-renderer" style={{ width: '100%', overflowX: 'auto', minWidth: 0 }}>
        <iframe
          ref={iframeRef}
          srcDoc={iframeSrcDoc}
          title="Email HTML Content"
          sandbox="allow-popups allow-same-origin"
          style={{
            width: iframeWidth,
            minWidth: '100%',
            height: iframeHeight,
            border: 'none',
            display: 'block'
          }}
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
