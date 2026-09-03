export const contactKeys = {
  all: scope => ['contacts', scope],
  tags: scope => [...contactKeys.all(scope), 'tags'],
  list: (scope, query, tag) => [...contactKeys.all(scope), 'list', query || '', tag || ''],
  self: scope => [...contactKeys.all(scope), 'self'],
};
