export const memoKeys = {
  all: scope => ['memos', scope],
  list: (scope, params) => [...memoKeys.all(scope), 'list', params],
};
