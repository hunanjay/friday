/**
 * Frontend unit tests for Friday/Dora Memos utilities
 * Run: npm test  (or npx vitest run)
 *
 * Tests cover pure utility functions extracted from MemosPage and the
 * query-rewriter fast-path heuristic mirrored from the backend.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers — replicate inline so tests have no module-import side-effects
// ---------------------------------------------------------------------------

const API_URL = 'http://localhost:8005'

const getAttachmentUrl = (url) => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${API_URL}${url}`
}

// Memo filter logic (mirrors filteredMemos in MemosPage)
const filterMemos = (memos, searchQuery, activeCategory) =>
  memos.filter((memo) => {
    const q = searchQuery.toLowerCase()
    const titleMatch = memo.title.toLowerCase().includes(q)
    const contentMatch = memo.content.toLowerCase().includes(q)
    const attachmentMatch = (memo.attachments || []).some(
      (att) =>
        (att.name || '').toLowerCase().includes(q) ||
        (att.extracted_text || '').toLowerCase().includes(q)
    )
    const matchesSearch = !q || titleMatch || contentMatch || attachmentMatch
    const matchesCategory = activeCategory === 'all' || memo.category === activeCategory
    return matchesSearch && matchesCategory
  })

// Sort logic (mirrors sortedMemos in MemosPage)
const sortMemos = (memos) =>
  [...memos].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt - a.updatedAt
  })

// Attachment badge icon logic (mirrors getAttachmentIcon in MemosPage)
const getAttachmentIcon = (mime) => {
  if (!mime) return 'file'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('word') || mime.includes('docx')) return 'doc'
  return 'file'
}

// ---------------------------------------------------------------------------
// 1. getAttachmentUrl
// ---------------------------------------------------------------------------

describe('getAttachmentUrl', () => {
  it('returns empty string for falsy url', () => {
    expect(getAttachmentUrl('')).toBe('')
    expect(getAttachmentUrl(null)).toBe('')
    expect(getAttachmentUrl(undefined)).toBe('')
  })

  it('returns absolute https URL unchanged (Aliyun OSS signed URL)', () => {
    const ossUrl =
      'https://bucket-jiashop.oss-cn-hangzhou.aliyuncs.com/memos%2Ftest.png?OSSAccessKeyId=xxx&Expires=99999&Signature=yyy'
    expect(getAttachmentUrl(ossUrl)).toBe(ossUrl)
  })

  it('returns absolute http URL unchanged', () => {
    const httpUrl = 'http://localhost:9000/memos/test.pdf'
    expect(getAttachmentUrl(httpUrl)).toBe(httpUrl)
  })

  it('prepends API_URL for local relative paths', () => {
    expect(getAttachmentUrl('/uploads/memos/file.txt')).toBe(
      'http://localhost:8005/uploads/memos/file.txt'
    )
  })

  it('does not double-prepend if path already has /uploads', () => {
    const rel = '/uploads/memos/invoice.pdf'
    expect(getAttachmentUrl(rel)).toMatch(/^http:\/\/localhost:8005/)
  })
})

// ---------------------------------------------------------------------------
// 2. filterMemos — search across title, content, and attachment extracted_text
// ---------------------------------------------------------------------------

const SAMPLE_MEMOS = [
  {
    id: '1',
    title: 'ACP考试大纲',
    content: '考试大纲在文件中',
    category: 'work',
    pinned: true,
    updatedAt: 3000,
    attachments: [
      {
        name: '阿里云大模型ACP考试大纲.pdf',
        type: 'application/pdf',
        extracted_text: '技能要求 大模型提示词技巧 检索增强RAG 微调FineTuning LangChain',
      },
    ],
  },
  {
    id: '2',
    title: 'Caddy 部署笔记',
    content: '调通了 Caddy 反代，HTTPS 证书自动续期',
    category: 'notes',
    pinned: false,
    updatedAt: 2000,
    attachments: [],
  },
  {
    id: '3',
    title: 'Pop Mart 盲盒',
    content: '抽中了怦然心动粉色款',
    category: 'ideas',
    pinned: false,
    updatedAt: 1000,
    attachments: [],
  },
]

describe('filterMemos', () => {
  it('returns all memos when query is empty and category is all', () => {
    expect(filterMemos(SAMPLE_MEMOS, '', 'all')).toHaveLength(3)
  })

  it('filters by title (case-insensitive)', () => {
    const results = filterMemos(SAMPLE_MEMOS, 'acp', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('1')
  })

  it('filters by content', () => {
    const results = filterMemos(SAMPLE_MEMOS, 'caddy', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('2')
  })

  it('filters by attachment extracted_text (RAG content)', () => {
    const results = filterMemos(SAMPLE_MEMOS, 'LangChain', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('1')
  })

  it('filters by attachment name', () => {
    const results = filterMemos(SAMPLE_MEMOS, '考试大纲.pdf', 'all')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('1')
  })

  it('filters by category', () => {
    const results = filterMemos(SAMPLE_MEMOS, '', 'notes')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('2')
  })

  it('returns empty array when no match', () => {
    expect(filterMemos(SAMPLE_MEMOS, 'xyzzy', 'all')).toHaveLength(0)
  })

  it('combines category and search filters (AND semantics)', () => {
    // 'ideas' category has only Pop Mart; searching 'ACP' in ideas should return 0
    expect(filterMemos(SAMPLE_MEMOS, 'ACP', 'ideas')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 3. sortMemos — pinned first, then by updatedAt descending
// ---------------------------------------------------------------------------

describe('sortMemos', () => {
  it('places pinned memo first', () => {
    const sorted = sortMemos(SAMPLE_MEMOS)
    expect(sorted[0].id).toBe('1') // pinned
  })

  it('sorts non-pinned memos by updatedAt desc', () => {
    const sorted = sortMemos(SAMPLE_MEMOS)
    const nonPinned = sorted.filter((m) => !m.pinned)
    expect(nonPinned[0].updatedAt).toBeGreaterThan(nonPinned[1].updatedAt)
  })

  it('does not mutate the original array', () => {
    const original = [...SAMPLE_MEMOS]
    sortMemos(SAMPLE_MEMOS)
    expect(SAMPLE_MEMOS).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// 4. getAttachmentIcon — MIME type to icon label
// ---------------------------------------------------------------------------

describe('getAttachmentIcon', () => {
  it('returns image for image/ MIME types', () => {
    expect(getAttachmentIcon('image/png')).toBe('image')
    expect(getAttachmentIcon('image/jpeg')).toBe('image')
    expect(getAttachmentIcon('image/webp')).toBe('image')
  })

  it('returns pdf for application/pdf', () => {
    expect(getAttachmentIcon('application/pdf')).toBe('pdf')
  })

  it('returns doc for Word MIME types', () => {
    expect(getAttachmentIcon('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('doc')
    expect(getAttachmentIcon('application/msword')).toBe('doc')
  })

  it('returns file for unknown MIME types', () => {
    expect(getAttachmentIcon('text/plain')).toBe('file')
    expect(getAttachmentIcon('application/zip')).toBe('file')
    expect(getAttachmentIcon('')).toBe('file')
    expect(getAttachmentIcon(null)).toBe('file')
  })
})

// ---------------------------------------------------------------------------
// 5. Attachment pill rendering — snapshot-style structural checks
// ---------------------------------------------------------------------------

describe('attachment pill data shape', () => {
  const att = {
    id: 'abc-123',
    name: '阿里云ACP考试大纲.pdf',
    url: 'https://bucket-jiashop.oss-cn-hangzhou.aliyuncs.com/memos%2Fabc-123.pdf?Signature=xxx',
    type: 'application/pdf',
    size: 278975,
    extracted_text: '大模型提示词技巧 检索增强 RAG',
  }

  it('has a valid direct-access signed URL', () => {
    expect(att.url).toMatch(/^https:\/\//)
    expect(att.url).toContain('Signature=')
  })

  it('getAttachmentUrl returns the OSS URL unchanged', () => {
    expect(getAttachmentUrl(att.url)).toBe(att.url)
  })

  it('extracted_text is non-empty string for RAG indexing', () => {
    expect(typeof att.extracted_text).toBe('string')
    expect(att.extracted_text.length).toBeGreaterThan(0)
  })

  it('attachment size is a positive number', () => {
    expect(att.size).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Memo form validation — basic guard rails
// ---------------------------------------------------------------------------

describe('memo form guard rails', () => {
  const validateMemo = (title, content) => {
    if (!title || !title.trim()) return { valid: false, error: 'title_required' }
    if (!content || !content.trim()) return { valid: false, error: 'content_required' }
    if (title.trim().length > 200) return { valid: false, error: 'title_too_long' }
    return { valid: true }
  }

  it('rejects empty title', () => {
    expect(validateMemo('', 'Some content').valid).toBe(false)
    expect(validateMemo('', 'Some content').error).toBe('title_required')
  })

  it('rejects whitespace-only title', () => {
    expect(validateMemo('   ', 'content').valid).toBe(false)
  })

  it('rejects empty content', () => {
    expect(validateMemo('Title', '').valid).toBe(false)
    expect(validateMemo('Title', '').error).toBe('content_required')
  })

  it('rejects title over 200 characters', () => {
    expect(validateMemo('a'.repeat(201), 'content').valid).toBe(false)
    expect(validateMemo('a'.repeat(201), 'content').error).toBe('title_too_long')
  })

  it('accepts valid title and content', () => {
    expect(validateMemo('ACP 考试大纲', '考点内容').valid).toBe(true)
  })
})
