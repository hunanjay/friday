import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../api/errors';
import { readComposeDraft, writeComposeDraft } from '../../pages/composeDraft';
import { useAuth } from '../auth/useAuth';
import {
  deleteMailMessage,
  MICROSOFT_MAIL_CHANNEL,
  saveMicrosoftDraft,
  sendMail,
} from './mailboxApi';

export const GRAPH_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
export const SMTP_ATTACHMENT_LIMIT = 20 * 1024 * 1024;

export function useMailCompose({
  connectionErrorMessage,
  onSent,
  onToast,
  sentMessage,
}) {
  const { authToken, handleLogout } = useAuth();
  const [restoredDraft] = useState(readComposeDraft);
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState(restoredDraft.to);
  const [composeCc, setComposeCc] = useState(restoredDraft.cc);
  const [composeBcc, setComposeBcc] = useState(restoredDraft.bcc);
  const [showCopyFields, setShowCopyFields] = useState(
    Boolean(restoredDraft.cc || restoredDraft.bcc),
  );
  const [composeSubject, setComposeSubject] = useState(restoredDraft.subject);
  const [composeBody, setComposeBody] = useState(restoredDraft.body);
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [composeChannel, setComposeChannel] = useState(MICROSOFT_MAIL_CHANNEL);
  const [isSending, setIsSending] = useState(false);
  const [replyToEmailId, setReplyToEmailId] = useState(null);
  const [composeMode, setComposeMode] = useState(null);
  const draftIdRef = useRef(restoredDraft.draftId);
  const draftSyncTimer = useRef(null);

  useEffect(() => {
    writeComposeDraft({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      body: composeBody,
      draftId: draftIdRef.current,
    });
  }, [composeBcc, composeBody, composeCc, composeSubject, composeTo]);

  useEffect(() => {
    if (!isComposing || replyToEmailId || composeChannel !== MICROSOFT_MAIL_CHANNEL) return;
    if (!(composeTo || composeCc || composeBcc || composeSubject || composeBody)) return;
    clearTimeout(draftSyncTimer.current);
    draftSyncTimer.current = setTimeout(() => {
      const draftId = draftIdRef.current;
      saveMicrosoftDraft(authToken, {
        draftId,
        to: composeTo,
        cc: composeCc,
        bcc: composeBcc,
        subject: composeSubject,
        body: composeBody,
      })
        .then(data => {
          if (!data?.id) return;
          draftIdRef.current = data.id;
          writeComposeDraft({
            to: composeTo,
            cc: composeCc,
            bcc: composeBcc,
            subject: composeSubject,
            body: composeBody,
            draftId: data.id,
          });
        })
        // Outlook mirroring is best-effort. The browser draft remains the
        // source of truth and compose/send must continue when Graph is down.
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(draftSyncTimer.current);
  }, [
    authToken,
    composeBcc,
    composeBody,
    composeCc,
    composeChannel,
    composeSubject,
    composeTo,
    isComposing,
    replyToEmailId,
  ]);

  const addAttachments = useCallback((files, tooLargeMessage) => {
    const additions = Array.from(files || []);
    const limit = composeChannel === MICROSOFT_MAIL_CHANNEL
      ? GRAPH_ATTACHMENT_LIMIT
      : SMTP_ATTACHMENT_LIMIT;
    const total = [...composeAttachments, ...additions]
      .reduce((sum, file) => sum + file.size, 0);
    if (total > limit) {
      onToast?.(tooLargeMessage({
        total: (total / 1048576).toFixed(1),
        limit: Math.round(limit / 1048576),
      }));
      return false;
    }
    setComposeAttachments(current => [...current, ...additions]);
    return true;
  }, [composeAttachments, composeChannel, onToast]);

  const removeAttachment = useCallback(index => {
    setComposeAttachments(current => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const resetCompose = useCallback(() => {
    draftIdRef.current = null;
    setIsComposing(false);
    setReplyToEmailId(null);
    setComposeMode(null);
    setComposeTo('');
    setComposeCc('');
    setComposeBcc('');
    setShowCopyFields(false);
    setComposeSubject('');
    setComposeBody('');
    setComposeAttachments([]);
  }, []);

  const submitCompose = useCallback(async event => {
    event?.preventDefault?.();
    if (!composeTo || !composeSubject || !composeBody) {
      window.alert('Please fill out all fields');
      return false;
    }

    setIsSending(true);
    try {
      await sendMail(authToken, {
        channel: composeChannel,
        messageId: replyToEmailId,
        mode: composeMode,
        to: composeTo,
        cc: composeCc,
        bcc: composeBcc,
        subject: composeSubject,
        body: composeBody,
        attachments: composeAttachments,
      });

      if (draftIdRef.current && !replyToEmailId) {
        void deleteMailMessage(authToken, draftIdRef.current, { permanent: true })
          .catch(() => {});
      }
      resetCompose();
      onToast?.(sentMessage);
      onSent?.();
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        void handleLogout();
      } else if (isApiError(error)) {
        onToast?.(error.message);
      } else {
        onToast?.(connectionErrorMessage);
      }
      return false;
    } finally {
      setIsSending(false);
    }
  }, [
    authToken,
    composeAttachments,
    composeBcc,
    composeBody,
    composeCc,
    composeChannel,
    composeMode,
    composeSubject,
    composeTo,
    connectionErrorMessage,
    handleLogout,
    onSent,
    onToast,
    replyToEmailId,
    resetCompose,
    sentMessage,
  ]);

  const openFreshCompose = useCallback(() => {
    setReplyToEmailId(null);
    setComposeMode(null);
    setIsComposing(true);
  }, []);

  const openComposeFor = useCallback((selectedEmail, mode, { body = '' } = {}) => {
    if (!selectedEmail) return;
    const senderAddress = selectedEmail.sender?.emailAddress?.address
      || selectedEmail.sender?.emailAddress?.name
      || '';
    draftIdRef.current = null;
    setComposeMode(mode);
    setReplyToEmailId(selectedEmail.id);
    setComposeChannel(selectedEmail.provider || MICROSOFT_MAIL_CHANNEL);
    setComposeTo(mode === 'forward' ? '' : senderAddress);
    setComposeCc('');
    setComposeBcc('');
    setShowCopyFields(false);
    setComposeSubject(
      mode === 'forward' ? `Fwd: ${selectedEmail.subject}` : `Re: ${selectedEmail.subject}`,
    );
    setComposeBody(body);
    setIsComposing(true);
  }, []);

  return {
    addAttachments,
    closeCompose: () => setIsComposing(false),
    composeAttachments,
    composeBcc,
    composeBody,
    composeCc,
    composeChannel,
    composeMode,
    composeSubject,
    composeTo,
    isComposing,
    isSending,
    openComposeFor,
    openFreshCompose,
    removeAttachment,
    setComposeBcc,
    setComposeBody,
    setComposeCc,
    setComposeChannel,
    setComposeSubject,
    setComposeTo,
    setShowCopyFields,
    showCopyFields,
    submitCompose,
  };
}
