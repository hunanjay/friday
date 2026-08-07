import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
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
  Heart,
  Briefcase as BusinessIcon,
  Zap,
} from '../components/common/Icons';
import ChatLogPasteModal from '../components/ChatLogPasteModal';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function ContactsPage() {
  const { authToken, showToast } = useWorkspace();
  const { i18n } = useTranslation();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);

  // Modals & Panels
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

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
  const [isSavingEdit, setIsSavingEdit] = useState(false);
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

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/contacts/tags`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAllTags(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  }, [authToken]);

  const fetchContacts = useCallback(async (query = '', tag = null) => {
    setIsLoading(true);
    try {
      let url = `${API_URL}/api/contacts?`;
      if (query) url += `query=${encodeURIComponent(query)}&`;
      if (tag) url += `tag=${encodeURIComponent(tag)}&`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setContacts(list);
        setSelectedContact(current => {
          if (!current) return list[0] || null;
          const updated = list.find(c => c.id === current.id);
          return updated || list[0] || null;
        });
      }
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchContacts(searchQuery, selectedTag);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedTag, fetchContacts]);

  // Sync from Microsoft
  const handleSyncMicrosoft = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_URL}/api/contacts/sync/microsoft`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        showToast(
          i18n.language === 'zh'
            ? `同步完成！导入新联系人 ${data.created} 个，更新 ${data.updated} 个`
            : `Synced ${data.total} contacts from Microsoft!`
        );
        fetchContacts(searchQuery, selectedTag);
      } else {
        const err = await res.json();
        alert(err.detail || (i18n.language === 'zh' ? '同步失败' : 'Sync failed'));
      }
    } catch (err) {
      console.error('Error syncing Microsoft contacts:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        const newContact = await res.json();
        showToast(i18n.language === 'zh' ? '联系人新建成功！' : 'Contact created!');
        setShowCreateModal(false);
        setForm({ name: '', email: '', phone: '', company: '', jobTitle: '', location: '' });
        setContacts(prev => [newContact, ...prev]);
        setSelectedContact(newContact);
      }
    } catch (err) {
      console.error('Error creating contact:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteContact = async (contactId) => {
    try {
      const res = await fetch(`${API_URL}/api/contacts/${encodeURIComponent(contactId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (res.ok) {
        showToast(i18n.language === 'zh' ? '联系人已删除' : 'Contact deleted');
        setContacts(prev => prev.filter(c => c.id !== contactId));
        if (selectedContact?.id === contactId) {
          const remaining = contacts.filter(c => c.id !== contactId);
          setSelectedContact(remaining[0] || null);
        }
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
      const res = await fetch(`${API_URL}/api/contacts/${encodeURIComponent(selectedContact.id)}/facts/${encodeURIComponent(factId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (res.ok) {
        showToast(i18n.language === 'zh' ? '已删除该条事实' : 'Fact deleted');
        const updatedProfiles = (selectedContact.profiles || []).filter(p => p.id !== factId);
        const updated = { ...selectedContact, profiles: updatedProfiles };
        setSelectedContact(updated);
        setContacts(prev => prev.map(c => c.id === selectedContact.id ? updated : c));
      }
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

    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API_URL}/api/contacts/${encodeURIComponent(selectedContact.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(editForm),
      });

      if (res.ok) {
        const updated = await res.json();
        showToast(i18n.language === 'zh' ? '资料修改已保存！' : 'Profile updated!');
        setSelectedContact(updated);
        setContacts(prev => prev.map(c => c.id === selectedContact.id ? updated : c));
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Error updating contact:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const isZh = i18n.language === 'zh';

  // Group profiles by dimension
  const profilesByDimension = (selectedContact?.profiles || []).reduce((acc, p) => {
    const dim = p.dimension || 'basic';
    if (!acc[dim]) acc[dim] = [];
    acc[dim].push(p);
    return acc;
  }, {});

  return (
    <div className="contacts-page-container">
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
              <div className="contact-detail-avatar-large">{(selectedContact.name?.[0] || 'C').toUpperCase()}</div>
              <div className="contact-detail-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2>{selectedContact.name}</h2>
                  {selectedContact.outlook_contact_id && (
                    <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                      MS Outlook
                    </span>
                  )}
                </div>
                <p className="contact-detail-subtitle">
                  {[selectedContact.jobTitle, selectedContact.company, selectedContact.location].filter(Boolean).join(' · ') || (isZh ? '联系人档案' : 'Profile')}
                </p>
              </div>

              <div className="contact-detail-top-actions">
                {!isEditing && (
                  <button type="button" className="action-icon-btn" onClick={handleStartEdit}>
                    <Edit3 size={16} />
                    <span>{isZh ? '编辑' : 'Edit'}</span>
                  </button>
                )}
                {selectedContact.email && !isEditing && (
                  <button type="button" className="action-icon-btn active" onClick={() => navigate('/email')}>
                    <Mail size={16} />
                    <span>{isZh ? '发邮件' : 'Email'}</span>
                  </button>
                )}
              </div>
            </header>

            <div className="contact-detail-body">
              {isEditing ? (
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
                      {isZh ? '4 大维度原子事实表 (Memory Profiles)' : 'Memory Profiles'}
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {/* Business Dimension */}
                      <div style={{ background: 'var(--bg-secondary, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid var(--border-light, #e2e8f0)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.85rem', color: '#2563eb', marginBottom: 8 }}>
                          <BusinessIcon size={16} />
                          <span>{isZh ? '商务事实 (Business)' : 'Business Facts'}</span>
                        </div>
                        {profilesByDimension.business?.length > 0 ? (
                          profilesByDimension.business.map((p) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.82rem', marginBottom: 6 }}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{p.fact_key}:</span> <span>{p.fact_value}</span>
                              </div>
                              <button type="button" onClick={() => handleDeleteFact(p.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}>
                                <Trash size={12} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{isZh ? '暂无商务事实' : 'No facts recorded'}</span>
                        )}
                      </div>

                      {/* Private Dimension */}
                      <div style={{ background: 'var(--bg-secondary, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid var(--border-light, #e2e8f0)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.85rem', color: '#ec4899', marginBottom: 8 }}>
                          <Heart size={16} />
                          <span>{isZh ? '私人喜好 (Private)' : 'Private Preferences'}</span>
                        </div>
                        {profilesByDimension.private?.length > 0 ? (
                          profilesByDimension.private.map((p) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.82rem', marginBottom: 6 }}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{p.fact_key}:</span> <span>{p.fact_value}</span>
                              </div>
                              <button type="button" onClick={() => handleDeleteFact(p.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}>
                                <Trash size={12} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{isZh ? '暂无私人喜好' : 'No facts recorded'}</span>
                        )}
                      </div>

                      {/* Dynamic Dimension */}
                      <div style={{ background: 'var(--bg-secondary, #f8fafc)', padding: 12, borderRadius: 8, border: '1px solid var(--border-light, #e2e8f0)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.85rem', color: '#8b5cf6', marginBottom: 8 }}>
                          <Zap size={16} />
                          <span>{isZh ? '动态与约定 (Dynamic)' : 'Dynamic Status'}</span>
                        </div>
                        {profilesByDimension.dynamic?.length > 0 ? (
                          profilesByDimension.dynamic.map((p) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.82rem', marginBottom: 6 }}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{p.fact_key}:</span> <span>{p.fact_value}</span>
                              </div>
                              <button type="button" onClick={() => handleDeleteFact(p.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}>
                                <Trash size={12} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{isZh ? '暂无动态约定' : 'No facts recorded'}</span>
                        )}
                      </div>

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
          fetchContacts(searchQuery, selectedTag);
          fetchTags();
          setSelectedContact(c);
        }}
      />
    </div>
  );
}
