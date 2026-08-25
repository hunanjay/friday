export const mailKeys = {
  all: scope => ['mail', scope],
  accounts: scope => [...mailKeys.all(scope), 'accounts'],
  providers: () => ['mail', 'providers'],
  microsoftStatus: scope => [...mailKeys.all(scope), 'microsoft-status'],
  messages: scope => [...mailKeys.all(scope), 'messages'],
  inboxUnread: (scope, accountIds) => [...mailKeys.all(scope), 'inbox-unread', accountIds],
  syncingInbox: scope => [...mailKeys.all(scope), 'syncing-inbox'],
};
