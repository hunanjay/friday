import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import {
  deleteMailMessage,
  generateMailReply,
  MICROSOFT_MAIL_CHANNEL,
} from './mailboxApi';

export function useMailActions({
  adjustInboxUnread,
  assistantDraftedMessage,
  emails,
  isZh,
  movedToTrashMessage,
  moveEmailToTrash,
  onToast,
  removeThreadMessage,
  selectedConversationKey,
  selectedEmail,
  threadMessages,
}) {
  const { authToken, handleLogout, user } = useAuth();
  const [aiDraft, setAiDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');

  useEffect(() => {
    setAiDraft('');
    setAiInstruction('');
  }, [selectedConversationKey]);

  const deleteMessage = useCallback(messageId => {
    const target = threadMessages.find(message => message.id === messageId)
      || emails.find(message => message.id === messageId);
    if (target && !target.isRead && target.parentFolderId === 'inbox') {
      adjustInboxUnread(-1);
    }
    moveEmailToTrash(messageId);
    removeThreadMessage(messageId);

    const isImap = target?.provider && target.provider !== MICROSOFT_MAIL_CHANNEL;
    onToast(isImap
      ? (isZh
          ? '邮件已永久删除（IMAP 无回收站）'
          : 'Email permanently deleted (no trash on IMAP)')
      : movedToTrashMessage);

    void deleteMailMessage(authToken, messageId).catch(error => {
      if (isApiError(error) && error.status === 401) void handleLogout();
    });
  }, [
    adjustInboxUnread,
    authToken,
    emails,
    handleLogout,
    isZh,
    moveEmailToTrash,
    movedToTrashMessage,
    onToast,
    removeThreadMessage,
    threadMessages,
  ]);

  const generateReply = useCallback(async intent => {
    if (!selectedEmail || !intent.trim()) return false;
    setIsDrafting(true);
    setAiDraft('');
    try {
      const data = await generateMailReply(authToken, {
        emailId: selectedEmail.id,
        intent,
        userName: user?.name || '',
      });
      setAiDraft(data.draft);
      onToast(assistantDraftedMessage);
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        void handleLogout();
      } else if (isApiError(error)) {
        setAiDraft(isZh
          ? `出错了：${error.message || '生成失败'}`
          : `Something went wrong: ${error.message || 'failed'}`);
      } else {
        setAiDraft(isZh
          ? '无法连接到助手服务，请稍后再试。'
          : "Couldn't reach the assistant service, please try again later.");
      }
      return false;
    } finally {
      setIsDrafting(false);
    }
  }, [
    assistantDraftedMessage,
    authToken,
    handleLogout,
    isZh,
    onToast,
    selectedEmail,
    user?.name,
  ]);

  return {
    aiDraft,
    aiInstruction,
    deleteMessage,
    generateReply,
    isDrafting,
    setAiInstruction,
  };
}
