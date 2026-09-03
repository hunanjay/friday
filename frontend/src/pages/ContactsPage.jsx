import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { useContactTags, useContacts, useSelfMemory } from '../features/contacts/hooks';
import { useUi } from '../hooks/useUi';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Trash,
  Mail,
  Phone,
  Building,
  Users,
  X,
  UserPlus,
  Edit3,
  RefreshCw,
  Sparkles,
  Tag as TagIcon,
  Clock,
  MapPin,
  ChevronLeft,
  Heart,
  UserIcon,
  Zap,
} from '../components/common/Icons';
import ChatLogPasteModal from '../components/ChatLogPasteModal';
import { DIMENSION_META, factDimensionOrder } from './contactDimensions';

// The user's own long-term memory uses category, not dimension, and always
// has exactly these three buckets - no "coined by the agent" extras to sort
// in, unlike a real contact's dimensions.
const SELF_CATEGORY_ORDER = ['profile', 'preference', 'topic'];
const SELF_CATEGORY_META = {
  profile: { zh: '个人信息 (Profile)', en: 'Profile Facts', emptyZh: '暂无个人信息', icon: UserIcon, color: '#0891b2' },
  preference: { zh: '偏好设置 (Preference)', en: 'Preferences', emptyZh: '暂无偏好设置', icon: Heart, color: '#ec4899' },
  topic: { zh: '话题习惯 (Topic)', en: 'Topic Habits', emptyZh: '暂无话题习惯', icon: Zap, color: '#8b5cf6' },
};

const API_URL = import.meta.env.VITE_API_URL || '';

// Where a memory fact was learned from. Keep in sync with contact_profiles.source_type.
const FACT_SOURCES = {
  manual: { zh: '手动录入', en: 'Manual', color: '#64748b', bg: '#f1f5f9' },
  chat: { zh: '对话记录', en: 'Chat', color: '#7c3aed', bg: '#ede9fe' },
  chat_paste: { zh: '聊天记录提炼', en: 'Chat log', color: '#0891b2', bg: '#cffafe' },
  email: { zh: '邮件', en: 'Email', color: '#c2410c', bg: '#ffedd5' },
  memo: { zh: '备忘录', en: 'Memo', color: '#15803d', bg: '#dcfce7' },
};

export function SourceBadge({ sourceType, origin, isZh }) {
  const meta = FACT_SOURCES[sourceType] || {
    zh: sourceType || '未知来源',
    en: sourceType || 'Unknown',
    color: '#94a3b8',
    bg: '#f1f5f9',
  };
  // Facts extracted from a pasted log point at the interaction row holding the
  // original snippet, so the badge can name the exact record on hover.
  const detail = origin
    ? `${new Date(origin.event_date).toLocaleDateString()} · ${origin.summary || ''}`
    : isZh ? '无关联原始记录' : 'No linked source record';

  return (
    <span
      title={detail}
      style={{
        fontSize: '0.68rem',
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
        padding: '1px 6px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        cursor: origin ? 'help' : 'default',
      }}
    >
      {isZh ? meta.zh : meta.en}
    </span>
  );
}

export function FactGroup({ title, icon, color, facts, emptyText, originsById, isZh, onDelete }) {
  return (
    <div style={{ background: 'var(--bg-secondary, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid var(--border-light, #e2e8f0)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.85rem', color, marginBottom: 8 }}>
        {icon}
        <span>{title}</span>
      </div>
      {facts?.length > 0 ? (
        facts.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.82rem', marginBottom: 6 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{p.fact_key}:</span> <span>{p.fact_value}</span>{' '}
              <SourceBadge sourceType={p.source_type} origin={originsById[p.source_id]} isZh={isZh} />
            </div>
            <button type="button" onClick={() => onDelete(p.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}>
              <Trash size={12} />
            </button>
          </div>
        ))
      ) : (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{emptyText}</span>
      )}
    </div>
  );
}

export default function ContactsPage() {
  const { authToken } = useAuth();
  const { showToast } = useUi();
  const { i18n } = useTranslation();
  const navigate = useNavigate();

  const [selectedTag, setSelectedTag] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);

  // Modals & Panels
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    jobTitle: '',
    location: '',
  });

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    jobTitle: '',
    location: '',
    ai_summary: '',
  });

  // Delete Confirmation
  const [deletingId, setDeletingId] = useState(null);

  const { contactTags: allTags, refetchContactTags } = useContactTags();
  const {
    contacts,
    isLoadingContacts: isLoading,
    syncMicrosoftContacts,
    isSyncingContacts: isSyncing,
    createContact,
    isCreatingContact: isCreating,
    updateContact,
    isUpdatingContact: isSavingEdit,
    deleteContact,
    deleteContactFact,
    refetchContacts,
  } = useContacts({ query: searchQuery, tag: selectedTag });
  const { selfMemory, deleteSelfMemoryFact } = useSelfMemory();

  useEffect(() => {
    setSelectedContact(current => {
      // The self-memory card isn't in `contacts`, so leave it selected.
      if (current?.id === 'me') return current;
      const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
      if (!current) return isDesktop ? (contacts[0] || null) : null;
      const updated = contacts.find(c => c.id === current.id);
      return updated || (isDesktop ? (contacts[0] || null) : null);
    });
  }, [contacts]);

  // Sync from Microsoft
  const handleSyncMicrosoft = async () => {
    try {
      const data = await syncMicrosoftContacts();
      showToast(
        i18n.language === 'zh'
          ? `同步完成！导入新联系人 ${data.created} 个，更新 ${data.updated} 个`
          : `Synced ${data.total} contacts from Microsoft!`
      );
    } catch (err) {
      alert(err.message || (i18n.language === 'zh' ? '同步失败' : 'Sync failed'));
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    try {
      const newContact = await createContact(form);
      showToast(i18n.language === 'zh' ? '联系人新建成功！' : 'Contact created!');
      setShowCreateModal(false);
      setForm({ name: '', email: '', phone: '', company: '', jobTitle: '', location: '' });
      setSelectedContact(newContact);
    } catch (err) {
      console.error('Error creating contact:', err);
    }
  };

  const handleDeleteContact = async (contactId) => {
    try {
      await deleteContact(contactId);
      showToast(i18n.language === 'zh' ? '联系人已删除' : 'Contact deleted');
      if (selectedContact?.id === contactId) {
        const remaining = contacts.filter(c => c.id !== contactId);
        setSelectedContact(remaining[0] || null);
      }
    } catch (err) {
      console.error('Error deleting contact:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteFact = async (factId) => {
    if (!selectedContact) return;
    try {
      if (selectedContact.id === 'me') {
        await deleteSelfMemoryFact(factId);
      } else {
        await deleteContactFact(selectedContact.id, factId);
      }
      showToast(i18n.language === 'zh' ? '已删除该条事实' : 'Fact deleted');
      const updatedProfiles = (selectedContact.profiles || []).filter(p => p.id !== factId);
      setSelectedContact({ ...selectedContact, profiles: updatedProfiles });
    } catch (err) {
      console.error('Error deleting fact:', err);
    }
  };

  const handleStartEdit = () => {
    if (!selectedContact) return;
    setEditForm({
      name: selectedContact.name || '',
      email: selectedContact.email || '',
      phone: selectedContact.phone || '',
      company: selectedContact.company || '',
      jobTitle: selectedContact.jobTitle || '',
      location: selectedContact.location || '',
      ai_summary: selectedContact.ai_summary || '',
    });
    setIsEditing(true);
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedContact || !editForm.name.trim()) return;

    try {
      const updated = await updateContact(selectedContact.id, editForm);
      showToast(i18n.language === 'zh' ? '资料修改已保存！' : 'Profile updated!');
      setSelectedContact(updated);
      setIsEditing(false);
    } catch (err) {
      console.error('Error updating contact:', err);
    }
  };

  const isZh = i18n.language === 'zh';
  const isSelf = selectedContact?.id === 'me';

  // Group profiles by dimension (self-memory rows carry category as dimension)
  const profilesByDimension = (selectedContact?.profiles || []).reduce((acc, p) => {
    const dim = p.dimension || 'basic';
    if (!acc[dim]) acc[dim] = [];
    acc[dim].push(p);
    return acc;
  }, {});
  const dimensionKeys = isSelf ? SELF_CATEGORY_ORDER : factDimensionOrder(profilesByDimension);

  // Interactions keyed by id: a fact's source_id points at the record it came from.
  const originsById = (selectedContact?.timeline || []).reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

  return (
    <div className={`contacts-page-container ${selectedContact ? 'has-selected-contact' : ''}`}>
      {/* Left Sidebar Panel */}
      <div className="contacts-list-panel">
        <div className="contacts-header-bar">
          <div className="contacts-title-group">
            <h3>{isZh ? '关系大脑' : 'Contact Brain'}</h3>
            <span className="contacts-count-badge">{contacts.length}</span>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="add-contact-btn"
              style={{ background: 'var(--bg-secondary, #f1f5f9)', color: 'var(--text-primary)' }}
              onClick={handleSyncMicrosoft}
              disabled={isSyncing}
              title={isZh ? '从 Outlook 同步通讯录' : 'Sync from Outlook'}
            >
              <RefreshCw size={14} className={isSyncing ? 'spinner' : ''} />
              <span>{isZh ? '同步 Outlook' : 'Sync'}</span>
            </button>

            <button
              type="button"
              className="add-contact-btn"
              onClick={() => setShowCreateModal(true)}
              title={isZh ? '新建联系人' : 'Add Contact'}
            >
              <UserPlus size={14} />
              <span>{isZh ? '新建' : 'Add'}</span>
            </button>
          </div>
        </div>

        {/* AI Chat Log Extract Banner */}
        <div
          onClick={() => setShowPasteModal(true)}
          style={{
            margin: '0 16px 12px 16px',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.08) 100%)',
            border: '1px solid rgba(99,102,241,0.2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: '#6366f1' }} />
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isZh ? '粘贴微信记录 AI 提炼' : 'Paste Chat Log AI Extract'}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>→</span>
        </div>

        {/* Search Box */}
        <div className="contacts-search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder={isZh ? '搜索姓名、公司、标签或事实...' : 'Search name, company, tags...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Tag Filters */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 16px 12px 16px', scrollbarWidth: 'none' }}>
            <button
              type="button"
              style={{
                padding: '3px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                border: 'none',
                cursor: 'pointer',
                background: selectedTag === null ? 'var(--accent-primary, #6366f1)' : 'var(--bg-secondary, #f1f5f9)',
                color: selectedTag === null ? '#fff' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setSelectedTag(null)}
            >
              {isZh ? '全部' : 'All'}
            </button>
            {allTags.map((t, idx) => (
              <button
                key={idx}
                type="button"
                style={{
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  border: 'none',
                  cursor: 'pointer',
                  background: selectedTag === t ? 'var(--accent-primary, #6366f1)' : 'var(--bg-secondary, #f1f5f9)',
                  color: selectedTag === t ? '#fff' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => setSelectedTag(selectedTag === t ? null : t)}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        {/* Contacts Scroll List */}
        <div className="contacts-scroll-list">
          {selfMemory && (
            <div
              className={`contact-card-item ${selectedContact?.id === 'me' ? 'selected' : ''}`}
              onClick={() => setSelectedContact(selfMemory)}
            >
              <div className="contact-card-avatar">{isZh ? '我' : 'Me'}</div>
              <div className="contact-card-info">
                <div className="contact-card-name-row">
                  <span className="contact-card-name">{isZh ? '我的长期记忆' : 'My Memory'}</span>
                </div>
                <span className="contact-card-company">
                  {isZh ? '助手记住的关于你的事实' : "What the assistant remembers about you"}
                </span>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="contacts-empty-state">
              <span className="spinner" style={{ width: 24, height: 24 }} />
              <p style={{ marginTop: 8 }}>{isZh ? '加载关系大脑...' : 'Loading contacts...'}</p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="contacts-empty-state">
              <Users size={36} style={{ opacity: 0.4 }} />
              <p style={{ marginTop: 8 }}>{isZh ? '未找到相关联系人' : 'No contacts found'}</p>
            </div>
          ) : (
            contacts.map((c) => {
              const isSelected = selectedContact?.id === c.id;
              const isDeleting = deletingId === c.id;

              return (
                <div
                  key={c.id}
                  className={`contact-card-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedContact(c)}
                >
                  <div className="contact-card-avatar">{(c.name?.[0] || 'C').toUpperCase()}</div>
                  <div className="contact-card-info">
                    <div className="contact-card-name-row">
                      <span className="contact-card-name">{c.name}</span>
                    </div>
                    {c.company && <span className="contact-card-company">{[c.jobTitle, c.company].filter(Boolean).join(' @ ')}</span>}
                    {c.tags && c.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {c.tags.slice(0, 3).map((t, idx) => (
                          <span key={idx} style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {!isDeleting && (
                    <div className="contact-card-actions">
                      <button
                        type="button"
                        className="contact-action-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingId(c.id);
                        }}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  )}

                  {isDeleting && (
                    <div className="contact-delete-confirm-popover" onClick={(e) => e.stopPropagation()}>
                      <span>{isZh ? '删除联系人？' : 'Delete?'}</span>
                      <button type="button" className="confirm-delete-yes-btn" onClick={() => handleDeleteContact(c.id)}>
                        {isZh ? '确定' : 'Yes'}
                      </button>
                      <button type="button" className="confirm-delete-no-btn" onClick={() => setDeletingId(null)}>
                        {isZh ? '取消' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Detail Panel */}
      <div className="contacts-detail-panel">
        {selectedContact ? (
          <div className="contact-detail-card">
            <header className="contact-detail-header">
              <button
                type="button"
                className="mobile-contacts-back-btn"
                onClick={() => setSelectedContact(null)}
                title={isZh ? '返回联系人列表' : 'Back to contacts'}
              >
                <ChevronLeft size={18} />
                <span>{isZh ? '返回' : 'Back'}</span>
              </button>
              <div className="contact-detail-avatar-large">{isSelf ? (isZh ? '我' : 'Me') : (selectedContact.name?.[0] || 'C').toUpperCase()}</div>
              <div className="contact-detail-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2>{isSelf ? (isZh ? '我的长期记忆' : 'My Memory') : selectedContact.name}</h2>
                  {selectedContact.outlook_contact_id && (
                    <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                      MS Outlook
                    </span>
                  )}
                </div>
                <p className="contact-detail-subtitle">
                  {isSelf
                    ? (isZh ? '跨会话共享的个人事实，每次对话助手都会看到。' : 'Facts shared across every chat session.')
                    : ([selectedContact.jobTitle, selectedContact.company, selectedContact.location].filter(Boolean).join(' · ') || (isZh ? '联系人档案' : 'Profile'))}
                </p>
              </div>

              <div className="contact-detail-top-actions">
                {!isSelf && !isEditing && (
                  <button type="button" className="action-icon-btn" onClick={handleStartEdit}>
                    <Edit3 size={16} />
                    <span>{isZh ? '编辑' : 'Edit'}</span>
                  </button>
                )}
                {!isSelf && selectedContact.email && !isEditing && (
                  <button type="button" className="action-icon-btn active" onClick={() => navigate('/email')}>
                    <Mail size={16} />
                    <span>{isZh ? '发邮件' : 'Email'}</span>
                  </button>
                )}
              </div>
            </header>

            <div className="contact-detail-body">
              {isSelf ? (
                <section style={{ marginTop: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {dimensionKeys.map((dim) => {
                      const meta = SELF_CATEGORY_META[dim];
                      const Icon = meta.icon;
                      return (
                        <FactGroup
                          key={dim}
                          title={isZh ? meta.zh : meta.en}
                          icon={<Icon size={16} />}
                          color={meta.color}
                          facts={profilesByDimension[dim]}
                          emptyText={isZh ? meta.emptyZh : `No ${dim} facts recorded`}
                          originsById={{}}
                          isZh={isZh}
                          onDelete={handleDeleteFact}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : isEditing ? (
                <form onSubmit={handleUpdateSubmit} className="contact-edit-form">
                  <h4>{isZh ? '修改联系人资料' : 'Edit Profile'}</h4>
                  <div className="contact-info-grid">
                    <div className="contact-info-item edit-mode">
                      <span className="info-label">{isZh ? '姓名 *' : 'Name'}</span>
                      <input type="text" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                    </div>
                    <div className="contact-info-item edit-mode">
                      <span className="info-label">{isZh ? '邮箱' : 'Email'}</span>
                      <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                    </div>
                    <div className="contact-info-item edit-mode">
                      <span className="info-label">{isZh ? '电话' : 'Phone'}</span>
                      <input type="text" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                    </div>
                    <div className="contact-info-item edit-mode">
                      <span className="info-label">{isZh ? '公司' : 'Company'}</span>
                      <input type="text" value={editForm.company} onChange={e => setEditForm({ ...editForm, company: e.target.value })} />
                    </div>
                    <div className="contact-info-item edit-mode">
                      <span className="info-label">{isZh ? '职位' : 'Job Title'}</span>
                      <input type="text" value={editForm.jobTitle} onChange={e => setEditForm({ ...editForm, jobTitle: e.target.value })} />
                    </div>
                    <div className="contact-info-item edit-mode">
                      <span className="info-label">{isZh ? '所在地' : 'Location'}</span>
                      <input type="text" value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
                    </div>
                  </div>

                  <div className="edit-actions-row" style={{ marginTop: 16 }}>
                    <button type="button" className="modal-cancel-btn" onClick={() => setIsEditing(false)} disabled={isSavingEdit}>
                      {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button type="submit" className="modal-submit-btn" disabled={isSavingEdit}>
                      {isSavingEdit ? '保存中...' : '保存修改'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {/* Basic Metadata Section */}
                  <section className="contact-info-section">
                    <h4>{isZh ? '基本资料' : 'Basic Meta'}</h4>
                    <div className="contact-info-grid">
                      <div className="contact-info-item">
                        <Mail size={16} className="info-icon" />
                        <div>
                          <span className="info-label">{isZh ? '邮箱' : 'Email'}</span>
                          <span className="info-value">{selectedContact.email || '-'}</span>
                        </div>
                      </div>
                      <div className="contact-info-item">
                        <Phone size={16} className="info-icon" />
                        <div>
                          <span className="info-label">{isZh ? '电话' : 'Phone'}</span>
                          <span className="info-value">{selectedContact.phone || '-'}</span>
                        </div>
                      </div>
                      <div className="contact-info-item">
                        <Building size={16} className="info-icon" />
                        <div>
                          <span className="info-label">{isZh ? '公司' : 'Company'}</span>
                          <span className="info-value">{selectedContact.company || '-'}</span>
                        </div>
                      </div>
                      <div className="contact-info-item">
                        <MapPin size={16} className="info-icon" />
                        <div>
                          <span className="info-label">{isZh ? '所在地' : 'Location'}</span>
                          <span className="info-value">{selectedContact.location || '-'}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* AI Summary */}
                  {selectedContact.ai_summary && (
                    <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: '8px', background: 'var(--bg-secondary, #f8fafc)', borderLeft: '3px solid #6366f1' }}>
                      <div style={{ fontSize: '0.8rem', color: '#6366f1', fontWeight: 600, marginBottom: 4 }}>
                        ✨ AI 一句话概括
                      </div>
                      <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', margin: 0 }}>{selectedContact.ai_summary}</p>
                    </div>
                  )}

                  {/* 4 Dimension Profiles & Facts Section */}
                  <section style={{ marginTop: 24 }}>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 12 }}>
                      {isZh ? '原子事实表 (Memory Profiles)' : 'Memory Profiles'}
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {dimensionKeys.map((dim) => {
                        const meta = DIMENSION_META[dim];
                        const Icon = meta?.icon || Sparkles;
                        return (
                          <FactGroup
                            key={dim}
                            title={meta ? (isZh ? meta.zh : meta.en) : dim}
                            icon={<Icon size={16} />}
                            color={meta?.color || '#64748b'}
                            facts={profilesByDimension[dim]}
                            emptyText={isZh ? (meta?.emptyZh || '暂无事实') : 'No facts recorded'}
                            originsById={originsById}
                            isZh={isZh}
                            onDelete={handleDeleteFact}
                          />
                        );
                      })}

                      {/* Tags Section */}
                      <div style={{ background: 'var(--bg-secondary, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid var(--border-light, #e2e8f0)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.85rem', color: '#10b981', marginBottom: 8 }}>
                          <TagIcon size={16} />
                          <span>{isZh ? '结构化标签 (Tags)' : 'Tags'}</span>
                        </div>
                        {selectedContact.tags?.length > 0 ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {selectedContact.tags.map((t, idx) => (
                              <span key={idx} style={{ fontSize: '0.78rem', background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
                                #{t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{isZh ? '暂无标签' : 'No tags'}</span>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Interaction Timeline */}
                  <section style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <Clock size={16} style={{ color: 'var(--text-secondary)' }} />
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>{isZh ? '互动时间线 (Interactions)' : 'Interaction Timeline'}</h4>
                    </div>

                    {selectedContact.timeline?.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {selectedContact.timeline.map((item) => (
                          <div key={item.id} style={{ padding: '10px 12px', background: 'var(--bg-secondary, #f8fafc)', borderRadius: 6, fontSize: '0.84rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, textTransform: 'uppercase', color: '#6366f1' }}>{item.source_type}</span>
                              <span>{new Date(item.event_date).toLocaleDateString()}</span>
                            </div>
                            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.summary}</div>
                            {item.raw_snippet && (
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                                "{item.raw_snippet.slice(0, 120)}..."
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                        {isZh ? '暂无互动记录，可在左侧使用 AI 粘贴提炼聊天记录。' : 'No interaction records.'}
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="contacts-empty-detail">
            <Users size={48} style={{ opacity: 0.3 }} />
            <h3>{isZh ? '未选择联系人' : 'No Contact Selected'}</h3>
            <p>{isZh ? '从左侧列表中选择一位联系人或点击上方同步微软通讯录' : 'Select a contact or sync from Outlook'}</p>
          </div>
        )}
      </div>

      {/* Create Contact Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="create-contact-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>{isZh ? '新建联系人 (服务端 DB)' : 'Create Contact'}</h4>
              <button type="button" className="close-modal-btn" onClick={() => setShowCreateModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="modal-form">
              <div className="form-group">
                <label>{isZh ? '姓名 *' : 'Name *'}</label>
                <input
                  type="text"
                  required
                  placeholder={isZh ? '请输入联系人姓名' : 'Name'}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>{isZh ? '电子邮箱' : 'Email'}</label>
                <input
                  type="email"
                  placeholder="john@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>{isZh ? '电话号码' : 'Phone'}</label>
                <input
                  type="text"
                  placeholder="+1 555-0199"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>{isZh ? '公司' : 'Company'}</label>
                  <input
                    type="text"
                    placeholder="Company"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>{isZh ? '职位' : 'Job Title'}</label>
                  <input
                    type="text"
                    placeholder="Job Title"
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="modal-cancel-btn" onClick={() => setShowCreateModal(false)} disabled={isCreating}>
                  {isZh ? '取消' : 'Cancel'}
                </button>
                <button type="submit" className="modal-submit-btn" disabled={isCreating || !form.name.trim()}>
                  {isCreating ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存联系人' : 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Chat Log AI Extract Modal */}
      <ChatLogPasteModal
        isOpen={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        authToken={authToken}
        API_URL={API_URL}
        isZh={isZh}
        onExtractSuccess={(c) => {
          refetchContacts();
          refetchContactTags();
          setSelectedContact(c);
        }}
      />
    </div>
  );
}
