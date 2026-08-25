export function groupMailThreads(emails, activeFolder) {
  const folderEmails = emails.filter(email => (
    !['inbox', 'sent', 'trash'].includes(activeFolder)
      || email.parentFolderId === activeFolder
  ));
  const threads = new Map();
  folderEmails.forEach(email => {
    const key = email.conversationId || email.id;
    const existing = threads.get(key);
    if (!existing) {
      threads.set(key, {
        ...email,
        _threadKey: key,
        _count: 1,
        _hasUnread: !email.isRead,
      });
      return;
    }
    const latest = new Date(email.receivedDateTime) > new Date(existing.receivedDateTime)
      ? email
      : existing;
    threads.set(key, {
      ...latest,
      _threadKey: key,
      _count: existing._count + 1,
      _hasUnread: existing._hasUnread || !email.isRead,
    });
  });
  return [...threads.values()].sort(
    (left, right) => new Date(right.receivedDateTime) - new Date(left.receivedDateTime),
  );
}

export function formatMailListDate(isoString, isZh) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = isZh
    ? date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}
