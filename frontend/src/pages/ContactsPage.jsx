import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Search, Plus, Trash, Mail, Phone, Building, Briefcase, Users, X, UserPlus, Edit3 } from '../components/common/Icons';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

export default function ContactsPage() {
  const { authToken, showToast } = useWorkspace();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    jobTitle: '',
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
  });

  // Delete Confirmation State
  const [deletingId, setDeletingId] = useState(null);

  const fetchContacts = async (query = '') => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/graph/contacts?query=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(Array.isArray(data) ? data : []);
        if (data.length > 0 && !selectedContact) {
          setSelectedContact(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchContacts(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, authToken]);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/graph/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        const newContact = await res.json();
        showToast(i18n.language === 'zh' ? '联系人新建成功！' : 'Contact created successfully!');
        setShowCreateModal(false);
        setForm({ name: '', email: '', phone: '', company: '', jobTitle: '' });
        setContacts(prev => [newContact, ...prev]);
        setSelectedContact(newContact);
      } else {
        const err = await res.json();
        alert(err.detail || (i18n.language === 'zh' ? '创建失败' : 'Failed to create contact'));
      }
    } catch (err) {
      console.error('Error creating contact:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteContact = async (contactId) => {
    try {
      const res = await fetch(`${API_URL}/api/graph/contacts/${encodeURIComponent(contactId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (res.ok) {
        showToast(i18n.language === 'zh' ? '联系人已成功删除' : 'Contact deleted');
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

  const handleStartEdit = () => {
    if (!selectedContact) return;
    setEditForm({
      name: selectedContact.name || '',
      email: selectedContact.email || '',
      phone: selectedContact.phone || '',
      company: selectedContact.company || '',
      jobTitle: selectedContact.jobTitle || '',
    });
    setIsEditing(true);
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedContact || !editForm.name.trim()) return;

    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API_URL}/api/graph/contacts/${encodeURIComponent(selectedContact.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(editForm),
      });

      if (res.ok) {
        const updated = await res.json();
        showToast(i18n.language === 'zh' ? '联系人资料已成功更新！' : 'Contact profile updated!');
        const newContact = { ...selectedContact, ...editForm };
        setSelectedContact(newContact);
        setContacts(prev => prev.map(c => c.id === selectedContact.id ? newContact : c));
        setIsEditing(false);
      } else {
        const err = await res.json();
        alert(err.detail || (i18n.language === 'zh' ? '更新失败' : 'Failed to update contact'));
      }
    } catch (err) {
      console.error('Error updating contact:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSendEmail = (email) => {
    navigate(`/email`);
  };

  const isZh = i18n.language === 'zh';

  return (
    <div className="contacts-page-container">
      {/* Sidebar / Contacts List Panel */}
      <div className="contacts-list-panel">
        <div className="contacts-header-bar">
          <div className="contacts-title-group">
            <h3>{isZh ? '通讯录' : 'Contacts'}</h3>
            <span className="contacts-count-badge">{contacts.length}</span>
          </div>
          <button
            type="button"
            className="add-contact-btn"
            onClick={() => setShowCreateModal(true)}
            title={isZh ? '新建联系人' : 'Add Contact'}
          >
            <UserPlus size={16} />
            <span>{isZh ? '新建' : 'Add'}</span>
          </button>
        </div>

        <div className="contacts-search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder={isZh ? '搜索姓名、邮箱、公司...' : 'Search name, email, company...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="contacts-scroll-list">
          {isLoading ? (
            <div className="contacts-empty-state">
              <span className="spinner" style={{ width: 24, height: 24 }}></span>
              <p style={{ marginTop: 8 }}>{isZh ? '正在加载通讯录...' : 'Loading contacts...'}</p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="contacts-empty-state">
              <Users size={36} style={{ opacity: 0.4 }} />
              <p style={{ marginTop: 8 }}>{isZh ? '未找到相关联系人' : 'No contacts found'}</p>
            </div>
          ) : (
            contacts.map(c => {
              const isSelected = selectedContact?.id === c.id;
              const isDeleting = deletingId === c.id;

              return (
                <div
                  key={c.id}
                  className={`contact-card-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedContact(c)}
                >
                  <div className="contact-card-avatar">
                    {(c.name?.[0] || 'C').toUpperCase()}
                  </div>
                  <div className="contact-card-info">
                    <div className="contact-card-name-row">
                      <span className="contact-card-name">{c.name}</span>
                    </div>
                    {c.email && <span className="contact-card-email">{c.email}</span>}
                    {c.company && (
                      <span className="contact-card-company">{c.company}</span>
                    )}
                  </div>

                  {/* Floating Actions */}
                  {!isDeleting && (
                    <div className="contact-card-actions">
                      <button
                        type="button"
                        className="contact-action-icon-btn"
                        title={isZh ? '删除联系人' : 'Delete Contact'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingId(c.id);
                        }}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  )}

                  {/* Double Check Popover */}
                  {isDeleting && (
                    <div className="contact-delete-confirm-popover" onClick={(e) => e.stopPropagation()}>
                      <span>{isZh ? '确认删除？' : 'Delete?'}</span>
                      <button
                        type="button"
                        className="confirm-delete-yes-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteContact(c.id);
                        }}
                      >
                        {isZh ? '确定' : 'Yes'}
                      </button>
                      <button
                        type="button"
                        className="confirm-delete-no-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingId(null);
                        }}
                      >
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

      {/* Main Contact Detail View (Knowledge Base Foundation) */}
      <div className="contacts-detail-panel">
        {selectedContact ? (
          <div className="contact-detail-card">
            <header className="contact-detail-header">
              <div className="contact-detail-avatar-large">
                {(selectedContact.name?.[0] || 'C').toUpperCase()}
              </div>
              <div className="contact-detail-meta">
                <h2>{selectedContact.name}</h2>
                <p className="contact-detail-subtitle">
                  {[selectedContact.jobTitle, selectedContact.company].filter(Boolean).join(' @ ') || (isZh ? '联系人卡片' : 'Contact Profile')}
                </p>
              </div>
              <div className="contact-detail-top-actions">
                {!isEditing && (
                  <button
                    type="button"
                    className="action-icon-btn"
                    onClick={handleStartEdit}
                  >
                    <Edit3 size={16} />
                    <span>{isZh ? '编辑资料' : 'Edit Profile'}</span>
                  </button>
                )}
                {selectedContact.email && !isEditing && (
                  <button
                    type="button"
                    className="action-icon-btn active"
                    onClick={() => handleSendEmail(selectedContact.email)}
                  >
                    <Mail size={16} />
                    <span>{isZh ? '发送邮件' : 'Send Email'}</span>
                  </button>
                )}
              </div>
            </header>

            <div className="contact-detail-body">
              {isEditing ? (
                <form onSubmit={handleUpdateSubmit} className="contact-edit-form">
                  <div className="contact-edit-header-title">
                    <h4>{isZh ? '修改联系人资料' : 'Edit Contact Profile'}</h4>
                  </div>
                  <div className="contact-info-grid">
                    <div className="contact-info-item edit-mode">
                      <Users size={18} className="info-icon" />
                      <div className="edit-input-group">
                        <span className="info-label">{isZh ? '姓名 *' : 'Name *'}</span>
                        <input
                          type="text"
                          required
                          value={editForm.name}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="contact-info-item edit-mode">
                      <Mail size={18} className="info-icon" />
                      <div className="edit-input-group">
                        <span className="info-label">{isZh ? '电子邮件' : 'Email Address'}</span>
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="contact-info-item edit-mode">
                      <Phone size={18} className="info-icon" />
                      <div className="edit-input-group">
                        <span className="info-label">{isZh ? '电话号码' : 'Phone Number'}</span>
                        <input
                          type="text"
                          value={editForm.phone}
                          onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="contact-info-item edit-mode">
                      <Building size={18} className="info-icon" />
                      <div className="edit-input-group">
                        <span className="info-label">{isZh ? '所属公司 / 组织' : 'Company / Organization'}</span>
                        <input
                          type="text"
                          value={editForm.company}
                          onChange={e => setEditForm({ ...editForm, company: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="contact-info-item edit-mode">
                      <Briefcase size={18} className="info-icon" />
                      <div className="edit-input-group">
                        <span className="info-label">{isZh ? '职位 / 部门' : 'Job Title / Department'}</span>
                        <input
                          type="text"
                          value={editForm.jobTitle}
                          onChange={e => setEditForm({ ...editForm, jobTitle: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="edit-actions-row">
                    <button
                      type="button"
                      className="modal-cancel-btn"
                      onClick={() => setIsEditing(false)}
                      disabled={isSavingEdit}
                    >
                      {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="modal-submit-btn"
                      disabled={isSavingEdit || !editForm.name.trim()}
                    >
                      {isSavingEdit ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存修改' : 'Save Changes')}
                    </button>
                  </div>
                </form>
              ) : (
                <section className="contact-info-section">
                  <h4>{isZh ? '基本信息' : 'Contact Information'}</h4>
                  <div className="contact-info-grid">
                    <div className="contact-info-item">
                      <Mail size={18} className="info-icon" />
                      <div>
                        <span className="info-label">{isZh ? '电子邮件' : 'Email Address'}</span>
                        <span className="info-value">{selectedContact.email || '-'}</span>
                      </div>
                    </div>

                    <div className="contact-info-item">
                      <Phone size={18} className="info-icon" />
                      <div>
                        <span className="info-label">{isZh ? '电话号码' : 'Phone Number'}</span>
                        <span className="info-value">{selectedContact.phone || '-'}</span>
                      </div>
                    </div>

                    <div className="contact-info-item">
                      <Building size={18} className="info-icon" />
                      <div>
                        <span className="info-label">{isZh ? '所属公司 / 组织' : 'Company / Organization'}</span>
                        <span className="info-value">{selectedContact.company || '-'}</span>
                      </div>
                    </div>

                    <div className="contact-info-item">
                      <Briefcase size={18} className="info-icon" />
                      <div>
                        <span className="info-label">{isZh ? '职位 / 部门' : 'Job Title / Department'}</span>
                        <span className="info-value">{selectedContact.jobTitle || '-'}</span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Knowledge Base & Agent Note Section (Foundational) */}
              <section className="contact-knowledge-section">
                <div className="knowledge-section-header">
                  <h4>{isZh ? 'AI 记忆与知识库备注 (Knowledge Base)' : 'AI Memory & Knowledge Notes'}</h4>
                  <span className="knowledge-badge">{isZh ? '智能体预留' : 'Agent Ready'}</span>
                </div>
                <div className="knowledge-card-box">
                  <p className="knowledge-placeholder">
                    {isZh
                      ? `包含与 ${selectedContact.name} 相关的历史讨论上下文、偏好备注与知识库条目。Chat 中的 Dora Agent 会结合这些背景知识辅助沟通。`
                      : `Holds historical context, preferences, and knowledge base notes for ${selectedContact.name}. Dora Agent will leverage this context during Chat.`}
                  </p>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="contacts-empty-detail">
            <Users size={48} style={{ opacity: 0.3 }} />
            <h3>{isZh ? '未选择联系人' : 'No Contact Selected'}</h3>
            <p>{isZh ? '从左侧列表中选择一位联系人以查看完整档案' : 'Select a contact from the list to view profile'}</p>
          </div>
        )}
      </div>

      {/* Create Contact Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="create-contact-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>{isZh ? '新建 Outlook 联系人' : 'Create Outlook Contact'}</h4>
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
                  placeholder={isZh ? '请输入联系人姓名' : 'e.g. John Doe'}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>{isZh ? '电子邮箱' : 'Email'}</label>
                <input
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>{isZh ? '电话号码' : 'Phone'}</label>
                <input
                  type="text"
                  placeholder="e.g. +1 555-0199"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>{isZh ? '公司' : 'Company'}</label>
                  <input
                    type="text"
                    placeholder="e.g. Microsoft"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>{isZh ? '职位' : 'Job Title'}</label>
                  <input
                    type="text"
                    placeholder="e.g. Product Manager"
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-cancel-btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={isCreating}
                >
                  {isZh ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="modal-submit-btn"
                  disabled={isCreating || !form.name.trim()}
                >
                  {isCreating ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存联系人' : 'Save Contact')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
