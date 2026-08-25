export const chatKeys = {
  all: scope => ['chat', scope],
  sessions: scope => [...chatKeys.all(scope), 'sessions'],
  session: (scope, sessionId) => [...chatKeys.sessions(scope), sessionId],
  messages: (scope, sessionId) => [...chatKeys.session(scope, sessionId), 'messages'],
  actions: (scope, sessionId) => [...chatKeys.session(scope, sessionId), 'actions'],
};
