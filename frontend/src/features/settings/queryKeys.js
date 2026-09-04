export const settingsKeys = {
  all: scope => ['settings', scope],
  assistantName: scope => [...settingsKeys.all(scope), 'assistant-name'],
  signatures: scope => [...settingsKeys.all(scope), 'signatures'],
  avatar: scope => [...settingsKeys.all(scope), 'avatar'],
  avatarPresets: scope => [...settingsKeys.all(scope), 'avatar-presets'],
  teamInfo: scope => [...settingsKeys.all(scope), 'team-info'],
  usageStats: scope => [...settingsKeys.all(scope), 'usage-stats'],
};
