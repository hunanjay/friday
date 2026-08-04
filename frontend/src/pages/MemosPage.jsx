import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';
import { Edit3, Plus, Search, Trash, Pin, X, Paperclip, FileText, Image as ImageIcon } from '../components/common/Icons';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

const getAttachmentUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_URL}${url}`;
};

export default function MemosPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    memos,
    handleAddMemo,
    handleUpdateMemo,
    handleDeleteMemo,
    authToken,
    showToast
  } = useWorkspace();

  const { t, i18n } = useTranslation();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [editingMemo, setEditingMemo] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form states for creating a new memo
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('ideas');
  const [newColor, setNewColor] = useState('beige');
  const [newAttachments, setNewAttachments] = useState([]);

  // Loading & Dragging States
  const [isUploadingNew, setIsUploadingNew] = useState(false);
  const [isUploadingEdit, setIsUploadingEdit] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Lightbox Preview State
  const [previewImage, setPreviewImage] = useState(null);

  const targetMemoId = location.state?.memoId;
  useEffect(() => {
    if (!targetMemoId) return;
    const memo = memos.find(item => item.id === targetMemoId);
    if (!memo) return;
    setSearchQuery('');
    setActiveCategory('all');
    setEditingMemo({ ...memo });
    navigate('/memos', { replace: true, state: null });
  }, [memos, navigate, targetMemoId]);

  // Filter memos
  const filteredMemos = memos.filter(memo => {
    const titleMatch = memo.title.toLowerCase().includes(searchQuery.toLowerCase());
    const contentMatch = memo.content.toLowerCase().includes(searchQuery.toLowerCase());
    const attachmentMatch = (memo.attachments || []).some(att =>
      (att.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (att.extracted_text || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
    const matchesSearch = titleMatch || contentMatch || attachmentMatch;
    const matchesCategory = activeCategory === 'all' || memo.category === activeCategory;

    return matchesSearch && matchesCategory;
  });

  // Sort memos: pinned first, then by date descending
  const sortedMemos = [...filteredMemos].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  const handleFileUpload = async (file, isEditing = false) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    if (isEditing) {
      setIsUploadingEdit(true);
    } else {
      setIsUploadingNew(true);
    }

    try {
      const res = await fetch(`${API_URL}/api/memos/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      if (res.ok) {
        const att = await res.json();
        showToast(i18n.language === 'zh' ? '文件解析与提取成功！' : 'File parsed successfully!');
        if (isEditing) {
          setEditingMemo(prev => ({
            ...prev,
            attachments: [...(prev.attachments || []), att],
          }));
        } else {
          setNewAttachments(prev => [...prev, att]);
        }
      } else {
        const err = await res.json();
        alert(err.detail || (i18n.language === 'zh' ? '上传失败' : 'Upload failed'));
      }
    } catch (err) {
      console.error('Error uploading file:', err);
    } finally {
      if (isEditing) {
        setIsUploadingEdit(false);
      } else {
        setIsUploadingNew(false);
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e, isEditing = false) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0], isEditing);
    }
  };

  const handleRemoveAttachment = (index, isEditing = false) => {
    if (isEditing) {
      setEditingMemo(prev => ({
        ...prev,
        attachments: (prev.attachments || []).filter((_, i) => i !== index),
      }));
    } else {
      setNewAttachments(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() && !newContent.trim() && newAttachments.length === 0) {
      alert(i18n.language === 'zh' ? '便签内容或附件不能全空' : 'Memo content or attachments cannot be empty');
      return;
    }

    await handleAddMemo({
      title: newTitle || (i18n.language === 'zh' ? '无标题便签' : 'Untitled Memo'),
      content: newContent,
      category: newCategory,
      color: newColor,
      attachments: newAttachments,
    });
    setIsCreateOpen(false);

    // Reset fields
    setNewTitle('');
    setNewContent('');
    setNewCategory('ideas');
    setNewColor('beige');
    setNewAttachments([]);

    showToast(i18n.language === 'zh' ? '便签新建成功！' : 'Memo created successfully!');
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    await handleUpdateMemo(editingMemo);
    setEditingMemo(null);
    showToast(i18n.language === 'zh' ? '便签已更新！' : 'Memo updated!');
  };

  const togglePin = async (memo, e) => {
    e.stopPropagation();
    await handleUpdateMemo({ ...memo, pinned: !memo.pinned });
    showToast(
      memo.pinned
        ? (i18n.language === 'zh' ? '便签已取消置顶' : 'Memo unpinned')
        : (i18n.language === 'zh' ? '便签已置顶到顶部' : 'Memo pinned to top')
    );
  };

  const deleteMemoClick = async (id, e) => {
    e.stopPropagation();
    await handleDeleteMemo(id);
    showToast(i18n.language === 'zh' ? '便签已删除' : 'Memo deleted');
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageFile = (att) => {
    const type = (att.type || '').toLowerCase();
    const name = (att.name || '').toLowerCase();
    return type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(name);
  };

  const colorClasses = {
    beige: 'memo-color-beige',
    amber: 'memo-color-amber',
    coral: 'memo-color-coral',
    teal: 'memo-color-teal',
    purple: 'memo-color-purple',
    gray: 'memo-color-gray',
  };

  const categories = ['all', 'work', 'ideas', 'notes', 'snippets'];

  const getCategoryLabel = (cat) => {
    if (cat === 'all') return i18n.language === 'zh' ? '全部' : 'All';
    if (cat === 'notes') return i18n.language === 'zh' ? '笔记' : 'Notes';
    return t(`memos.categories.${cat}`) || cat;
  };

  const isZh = i18n.language === 'zh';

  return (
    <div className="memos-tab-container">
      {/* Top action/filter bar */}
      <div className="memos-control-bar">
        <div className="memos-filter-tabs">
          {categories.map(cat => (
            <button
              key={cat}
              className={`memo-filter-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {getCategoryLabel(cat)}
            </button>
          ))}
        </div>

        <div className="memos-actions-wrapper">
          <div className="memos-search">
            <Search size={16} className="memo-search-icon" />
            <input
              type="text"
              placeholder={t('memos.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="new-memo-btn" onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} />
            <span>{t('memos.addMemo')}</span>
          </button>
        </div>
      </div>

      {/* Grid of notes */}
      {sortedMemos.length === 0 ? (
        <div className="memos-empty-state">
          <Edit3 size={48} className="empty-state-icon" />
          <h3>{isZh ? '未找到便签' : 'No notes found'}</h3>
          <p>{t('memos.emptyState')}</p>
        </div>
      ) : (
        <div className="memos-grid">
          {sortedMemos.map(memo => (
            <div
              key={memo.id}
              className={`memo-card ${colorClasses[memo.color] || 'memo-color-beige'} ${memo.pinned ? 'pinned' : ''}`}
              onClick={() => setEditingMemo({ ...memo })}
            >
              <div className="memo-card-header">
                <span className="memo-category-badge">{getCategoryLabel(memo.category)}</span>
                <div className="memo-card-actions">
                  <button
                    className={`pin-btn ${memo.pinned ? 'active' : ''}`}
                    onClick={(e) => togglePin(memo, e)}
                    title={memo.pinned ? t('memos.unpin') : t('memos.pin')}
                  >
                    <Pin size={16} />
                  </button>
                  <button
                    className="delete-memo-btn-icon"
                    onClick={(e) => deleteMemoClick(memo.id, e)}
                    title={t('common.delete')}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </div>
              <h3 className="memo-card-title">{memo.title}</h3>
              <p className="memo-card-content">{memo.content}</p>

              {/* Attachments Section on Memo Card */}
              {memo.attachments && memo.attachments.length > 0 && (
                <div className="memo-card-attachments">
                  {memo.attachments.map((att, idx) => {
                    const isImg = isImageFile(att);
                    return (
                      <div
                        key={att.id || idx}
                        className="memo-attachment-tag"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isImg) setPreviewImage(att);
                          else window.open(getAttachmentUrl(att.url), '_blank');
                        }}
                        title={att.name}
                      >
                        {isImg ? <ImageIcon size={12} /> : <FileText size={12} />}
                        <span className="attachment-filename">{att.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="memo-card-footer">
                <span className="memo-date">{memo.dateStr}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Memo Modal */}
      {isCreateOpen && (
        <div className="memo-modal-overlay" onClick={() => setIsCreateOpen(false)}>
          <div className="memo-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('memos.addMemo')}</h3>
              <button className="close-modal-btn" onClick={() => setIsCreateOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="memo-form">
              <div className="form-group">
                <input
                  type="text"
                  placeholder={t('memos.title')}
                  className="memo-title-input"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <textarea
                  placeholder={t('memos.content')}
                  className="memo-content-textarea"
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  rows="4"
                />
              </div>

              {/* Drag and Drop Zone */}
              <div
                className={`memo-attachment-dropzone ${isDragging ? 'is-dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, false)}
              >
                <div className="dropzone-content-row">
                  <Paperclip size={18} className="dropzone-icon" />
                  <div className="dropzone-text-group">
                    <span className="dropzone-primary-text">
                      {isZh ? '拖拽图片 / PDF / TXT / DOCX 文件到此处' : 'Drag & drop files here'}
                    </span>
                    <span className="dropzone-sub-text">
                      {isZh ? '或点击选择文件 (AI 自动 OCR 提取结构化文字)' : 'or click to browse for RAG parsing'}
                    </span>
                  </div>
                  <label className="upload-btn-label">
                    <span>{isZh ? '选择文件' : 'Browse'}</span>
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      accept="image/*,.pdf,.txt,.md,.docx"
                      onChange={(e) => handleFileUpload(e.target.files[0], false)}
                    />
                  </label>
                </div>

                {isUploadingNew && (
                  <div className="uploading-spinner-bar">
                    <span className="spinner" style={{ width: 14, height: 14 }}></span>
                    <span>{isZh ? '⚡ AI 正在提取图片/文档中的表单与全文内容...' : '⚡ AI parsing text content...'}</span>
                  </div>
                )}

                {newAttachments.length > 0 && (
                  <div className="attachments-pill-list">
                    {newAttachments.map((att, idx) => (
                      <div key={att.id || idx} className="attachment-pill">
                        {isImageFile(att) ? <ImageIcon size={13} /> : <FileText size={13} />}
                        <span className="pill-name">{att.name}</span>
                        {att.size && <span className="pill-size">({formatFileSize(att.size)})</span>}
                        <button
                          type="button"
                          className="remove-pill-btn"
                          onClick={() => handleRemoveAttachment(idx, false)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="memo-form-options">
                <div className="form-group select-category">
                  <label>{t('memos.category')}</label>
                  <select value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                    <option value="work">{t('memos.categories.work')}</option>
                    <option value="ideas">{t('memos.categories.ideas')}</option>
                    <option value="notes">{isZh ? '笔记' : 'Notes'}</option>
                    <option value="snippets">{t('memos.categories.snippets')}</option>
                  </select>
                </div>

                <div className="form-group select-color">
                  <label>{t('memos.color')}</label>
                  <div className="color-palette">
                    {['beige', 'amber', 'coral', 'teal', 'purple', 'gray'].map(col => (
                      <button
                        key={col}
                        type="button"
                        className={`color-btn color-${col} ${newColor === col ? 'selected' : ''}`}
                        onClick={() => setNewColor(col)}
                        title={t(`memos.colors.${col}`)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="cancel-btn" onClick={() => setIsCreateOpen(false)}>{t('common.cancel')}</button>
                <button type="submit" className="save-btn" disabled={isUploadingNew}>{t('memos.addMemo')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit/View Memo Modal */}
      {editingMemo && (
        <div className="memo-modal-overlay" onClick={() => setEditingMemo(null)}>
          <div className="memo-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('memos.editMemo')}</h3>
              <button className="close-modal-btn" onClick={() => setEditingMemo(null)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUpdateSubmit} className="memo-form">
              <div className="form-group">
                <input
                  type="text"
                  placeholder={t('memos.title')}
                  className="memo-title-input"
                  value={editingMemo.title}
                  onChange={e => setEditingMemo({ ...editingMemo, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <textarea
                  placeholder={t('memos.content')}
                  className="memo-content-textarea"
                  value={editingMemo.content}
                  onChange={e => setEditingMemo({ ...editingMemo, content: e.target.value })}
                  rows="4"
                />
              </div>

              {/* Drag and Drop Zone in Edit Modal */}
              <div
                className={`memo-attachment-dropzone ${isDragging ? 'is-dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, true)}
              >
                <div className="dropzone-content-row">
                  <Paperclip size={18} className="dropzone-icon" />
                  <div className="dropzone-text-group">
                    <span className="dropzone-primary-text">
                      {isZh ? '拖拽图片 / PDF / TXT / DOCX 文件到此处' : 'Drag & drop files here'}
                    </span>
                    <span className="dropzone-sub-text">
                      {isZh ? '或点击选择文件 (AI 自动 OCR 提取结构化文字)' : 'or click to browse for RAG parsing'}
                    </span>
                  </div>
                  <label className="upload-btn-label">
                    <span>{isZh ? '选择文件' : 'Browse'}</span>
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      accept="image/*,.pdf,.txt,.md,.docx"
                      onChange={(e) => handleFileUpload(e.target.files[0], true)}
                    />
                  </label>
                </div>

                {isUploadingEdit && (
                  <div className="uploading-spinner-bar">
                    <span className="spinner" style={{ width: 14, height: 14 }}></span>
                    <span>{isZh ? '⚡ AI 正在提取图片/文档中的表单与全文内容...' : '⚡ AI parsing text content...'}</span>
                  </div>
                )}

                {editingMemo.attachments && editingMemo.attachments.length > 0 && (
                  <div className="attachments-pill-list">
                    {editingMemo.attachments.map((att, idx) => (
                      <div key={att.id || idx} className="attachment-pill">
                        {isImageFile(att) ? <ImageIcon size={13} /> : <FileText size={13} />}
                        <a
                          href={getAttachmentUrl(att.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pill-name"
                          onClick={(e) => {
                            if (isImageFile(att)) {
                              e.preventDefault();
                              setPreviewImage(att);
                            }
                          }}
                        >
                          {att.name}
                        </a>
                        {att.size && <span className="pill-size">({formatFileSize(att.size)})</span>}
                        <button
                          type="button"
                          className="remove-pill-btn"
                          onClick={() => handleRemoveAttachment(idx, true)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="memo-form-options">
                <div className="form-group select-category">
                  <label>{t('memos.category')}</label>
                  <select
                    value={editingMemo.category}
                    onChange={e => setEditingMemo({ ...editingMemo, category: e.target.value })}
                  >
                    <option value="work">{t('memos.categories.work')}</option>
                    <option value="ideas">{t('memos.categories.ideas')}</option>
                    <option value="notes">{isZh ? '笔记' : 'Notes'}</option>
                    <option value="snippets">{t('memos.categories.snippets')}</option>
                  </select>
                </div>

                <div className="form-group select-color">
                  <label>{t('memos.color')}</label>
                  <div className="color-palette">
                    {['beige', 'amber', 'coral', 'teal', 'purple', 'gray'].map(col => (
                      <button
                        key={col}
                        type="button"
                        className={`color-btn color-${col} ${editingMemo.color === col ? 'selected' : ''}`}
                        onClick={() => setEditingMemo({ ...editingMemo, color: col })}
                        title={t(`memos.colors.${col}`)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="delete-event-btn"
                  onClick={(e) => {
                    deleteMemoClick(editingMemo.id, e);
                    setEditingMemo(null);
                  }}
                >
                  <Trash size={16} />
                  <span>{t('common.delete')}</span>
                </button>
                <button type="submit" className="save-btn" disabled={isUploadingEdit}>{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Lightbox Preview Modal */}
      {previewImage && (
        <div className="memo-lightbox-overlay" onClick={() => setPreviewImage(null)}>
          <div className="memo-lightbox-content" onClick={e => e.stopPropagation()}>
            <div className="lightbox-header">
              <span className="lightbox-title">{previewImage.name}</span>
              <button className="close-modal-btn" onClick={() => setPreviewImage(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="lightbox-image-wrapper">
              <img src={getAttachmentUrl(previewImage.url)} alt={previewImage.name} />
            </div>
            {previewImage.extracted_text && (
              <div className="lightbox-extracted-box">
                <h5>{isZh ? '⚡ AI 提炼文本内容 (Extracted Text)' : '⚡ AI Extracted Text'}</h5>
                <pre>{previewImage.extracted_text}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
