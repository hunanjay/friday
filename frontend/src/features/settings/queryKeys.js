export const settingsKeys = {
  all: scope => ['settings', scope],
  assistantName: scope => [...settingsKeys.all(scope), 'assistant-name'],
  signature: scope => [...settingsKeys.all(scope), 'signature'],
  avatar: scope => [...settingsKeys.all(scope), 'avatar'],
  avatarPresets: scope => [...settingsKeys.all(scope), 'avatar-presets'],
};
