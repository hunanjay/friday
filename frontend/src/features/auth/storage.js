const PRIVATE_WORKSPACE_KEYS = ['user', 'emails', 'events', 'messages'];

export function readCachedUser() {
  const saved = localStorage.getItem('user');
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

export function cacheUser(user) {
  if (user) localStorage.setItem('user', JSON.stringify(user));
  else localStorage.removeItem('user');
}

export function clearPrivateWorkspaceStorage() {
  PRIVATE_WORKSPACE_KEYS.forEach(key => localStorage.removeItem(key));
}
