export const dashboardKeys = {
  all: ['dashboard'],
  inbox: (scope, accountIds) => [...dashboardKeys.all, 'inbox', scope, ...accountIds],
  todos: scope => [...dashboardKeys.all, 'todos', scope],
};
