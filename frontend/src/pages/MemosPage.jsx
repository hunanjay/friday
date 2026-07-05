import React, { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Edit3, Plus, Search, Trash, Pin, X } from '../components/common/Icons';

export default function MemosPage() {
  const {
    memos,
    handleAddMemo,
    handleUpdateMemo,
    handleDeleteMemo,
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

  // Filter memos
  const filteredMemos = memos.filter(memo => {
    const matchesSearch = memo.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          memo.content.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = activeCategory === 'all' || memo.category === activeCategory;

    return matchesSearch && matchesCategory;
  });

  // Sort memos: pinned first, then by date descending
  const sortedMemos = [...filteredMemos].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (!newTitle.trim() && !newContent.trim()) {
      alert(i18n.language === 'zh' ? '便签内容不能完全为空' : 'Memo cannot be completely empty');
      return;
    }

    const memo = {
      id: 'memo_' + Date.now(),
      title: newTitle || (i18n.language === 'zh' ? '无标题便签' : 'Untitled Memo'),
      content: newContent,
      category: newCategory,
      color: newColor,
      pinned: false,
      updatedAt: Date.now(),
      dateStr: new Date().toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    handleAddMemo(memo);
    setIsCreateOpen(false);
    
    // Reset fields
    setNewTitle('');
    setNewContent('');
    setNewCategory('ideas');
    setNewColor('beige');

    showToast(i18n.language === 'zh' ? '便签新建成功！' : 'Memo created successfully!');
  };

  const handleUpdateSubmit = (e) => {
    e.preventDefault();
    handleUpdateMemo(editingMemo);
    setEditingMemo(null);
    showToast(i18n.language === 'zh' ? '便签已更新！' : 'Memo updated!');
  };

  const togglePin = (memo, e) => {
    e.stopPropagation();
    handleUpdateMemo({
      ...memo,
      pinned: !memo.pinned,
      updatedAt: Date.now()
    });
    showToast(
      memo.pinned 
        ? (i18n.language === 'zh' ? '便签已取消置顶' : 'Memo unpinned') 
        : (i18n.language === 'zh' ? '便签已置顶到顶部' : 'Memo pinned to top')
    );
  };

  const deleteMemoClick = (id, e) => {
    e.stopPropagation();
    handleDeleteMemo(id);
    showToast(i18n.language === 'zh' ? '便签已删除' : 'Memo deleted');
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
          <h3>{i18n.language === 'zh' ? '未找到便签' : 'No notes found'}</h3>
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
                  rows="6"
                  required
                />
              </div>

              <div className="memo-form-options">
                <div className="form-group select-category">
                  <label>{t('memos.category')}</label>
                  <select value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                    <option value="work">{t('memos.categories.work')}</option>
                    <option value="ideas">{t('memos.categories.ideas')}</option>
                    <option value="notes">{i18n.language === 'zh' ? '笔记' : 'Notes'}</option>
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
                <button type="submit" className="save-btn">{t('memos.addMemo')}</button>
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
                  rows="6"
                  required
                />
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
                    <option value="notes">{i18n.language === 'zh' ? '笔记' : 'Notes'}</option>
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
                <button type="submit" className="save-btn">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
