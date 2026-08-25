export const memoKeys = {
  all: scope => ['memos', scope],
  list: scope => [...memoKeys.all(scope), 'list'],
};
