export const mailKeys = {
  all: scope => ['mail', scope],
  accounts: scope => [...mailKeys.all(scope), 'accounts'],
  providers: () => ['mail', 'providers'],
  microsoftStatus: scope => [...mailKeys.all(scope), 'microsoft-status'],
};
