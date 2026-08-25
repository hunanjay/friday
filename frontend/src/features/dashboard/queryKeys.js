export const dashboardKeys = {
  all: ['dashboard'],
  todos: scope => [...dashboardKeys.all, 'todos', scope],
};
