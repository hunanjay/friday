export const githubKeys = {
  all: scope => ['github', scope],
  status: scope => [...githubKeys.all(scope), 'status'],
  repositories: scope => [...githubKeys.all(scope), 'repositories'],
};
