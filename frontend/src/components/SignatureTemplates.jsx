import React, { useEffect, useRef, useState } from 'react';
import { useSignatures } from '../features/settings/hooks';
import { CheckCircle, Edit3, Plus, Trash } from './common/Icons';

const MAX_CONTENT = 1000;
const MAX_NAME = 40;

const blankDraft = isZh => ({ id: null, name: isZh ? '新签名' : 'New signature', content: '' });

export default function SignatureTemplates({ isZh, showToast, autoEdit = false }) {
  const {
    signatures,
    createSignature,
    updateSignature,
    setDefaultSignature,
    deleteSignature,
    isSavingSignature,
    isLoadingSignatures,
  } = useSignatures();
  // One draft holds both "new" and "editing an existing one"; they differ only
  // by whether it carries an id.
  const [draft, setDraft] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  // Open the default template once the list has actually arrived - firing on
  // mount would edit a blank draft while the real one was still loading. The
  // ref keeps a cancelled editor from springing back open.
  const autoEditHandled = useRef(false);
  useEffect(() => {
    if (!autoEdit || autoEditHandled.current || isLoadingSignatures) return;
    autoEditHandled.current = true;
    const current = signatures.find(item => item.is_default);
    setDraft(current
      ? { id: current.id, name: current.name, content: current.content }
      : blankDraft(isZh));
  }, [autoEdit, isLoadingSignatures, signatures, isZh]);

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      showToast(isZh ? '请填写签名名称' : 'Give the signature a name');
      return;
    }
    const fields = { name, content: draft.content.trim() };
    try {
      await (draft.id ? updateSignature({ id: draft.id, ...fields }) : createSignature(fields));
      showToast(isZh ? '签名已保存' : 'Signature saved');
      setDraft(null);
    } catch {
      showToast(isZh ? '保存失败' : 'Failed to save signature');
    }
  };

  const promote = async (item) => {
    try {
      await setDefaultSignature(item.id);
      showToast(isZh ? `已切换到「${item.name}」` : `Now signing with "${item.name}"`);
    } catch {
      showToast(isZh ? '切换失败' : 'Failed to switch signature');
    }
  };

  const remove = async (item) => {
    setConfirmingDelete(null);
    try {
      await deleteSignature(item.id);
      showToast(isZh ? '签名已删除' : 'Signature deleted');
    } catch {
      showToast(isZh ? '删除失败' : 'Failed to delete signature');
    }
  };

  return (
    <>
      <div className="settings-signature-head">
        <div>
          <div className="settings-field-label">{isZh ? '邮件签名' : 'Email Signature'}</div>
          <div className="settings-field-hint">
            {isZh
              ? '可以保存多个签名，标为「默认」的那个会附加在每封发出邮件末尾，对所有邮箱账号和 AI 代发都生效。'
              : 'Keep several signatures; the one marked Default is appended to every email you send, from any bound account and from the assistant.'}
          </div>
        </div>
        {!draft && (
          <button
            type="button"
            className="settings-btn settings-signature-edit-btn"
            onClick={() => setDraft(blankDraft(isZh))}
          >
            <Plus size={14} />
            {isZh ? '新建' : 'New'}
          </button>
        )}
      </div>

      {signatures.length === 0 && !draft && (
        <p className="settings-signature-static settings-signature-preview-empty">
          {isZh ? '还没有签名，点击「新建」添加' : 'No signatures yet. Click New to add one.'}
        </p>
      )}

      <div className="signature-list">
        {signatures.map(item => (
          <div className="signature-row" key={item.id}>
            <div className="signature-row-head">
              <div className="signature-row-name">
                {item.name}
                {item.is_default && (
                  <span className="signature-default-badge">
                    <CheckCircle size={12} />
                    {isZh ? '默认' : 'Default'}
                  </span>
                )}
              </div>
              <div className="settings-row-actions">
              {!item.is_default && (
                <button type="button" className="settings-btn" onClick={() => promote(item)}>
                  {isZh ? '设为默认' : 'Use this'}
                </button>
              )}
              <button
                type="button"
                className="settings-btn"
                onClick={() => setDraft({ id: item.id, name: item.name, content: item.content })}
              >
                <Edit3 size={14} />
                {isZh ? '编辑' : 'Edit'}
              </button>
              {confirmingDelete === item.id ? (
                <>
                  <button type="button" className="settings-btn btn-danger" onClick={() => remove(item)}>
                    {isZh ? '确认删除' : 'Confirm'}
                  </button>
                  <button type="button" className="settings-btn" onClick={() => setConfirmingDelete(null)}>
                    {isZh ? '取消' : 'Cancel'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="settings-btn btn-danger-outline"
                  aria-label={isZh ? `删除 ${item.name}` : `Delete ${item.name}`}
                  onClick={() => setConfirmingDelete(item.id)}
                >
                  <Trash size={14} />
                </button>
              )}
              </div>
            </div>
            <p className="settings-signature-static">
              {item.content || (isZh ? '（空签名，等于不加签名）' : '(empty — sends nothing)')}
            </p>
          </div>
        ))}
      </div>

      {draft && (
        <div className="signature-editor">
          <input
            className="settings-text-input"
            value={draft.name}
            maxLength={MAX_NAME}
            aria-label={isZh ? '签名名称' : 'Signature name'}
            placeholder={isZh ? '名称，如「对外」「内部」' : 'Name, e.g. Work or Personal'}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
          />
          <textarea
            className="settings-signature-textarea"
            autoFocus
            value={draft.content}
            maxLength={MAX_CONTENT}
            rows={6}
            placeholder={isZh ? '此致\n张三\n产品经理 · Friday' : 'Best regards,\nJane Doe\nProduct Manager, Friday'}
            onChange={e => setDraft({ ...draft, content: e.target.value })}
          />
          <div className="settings-pane-foot">
            <span>{draft.content.length}/{MAX_CONTENT}</span>
            <div className="settings-row-actions">
              <button type="button" className="settings-btn" onClick={() => setDraft(null)}>
                {isZh ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                className="settings-btn btn-primary"
                disabled={isSavingSignature}
                onClick={save}
              >
                {isSavingSignature ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '保存' : 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
