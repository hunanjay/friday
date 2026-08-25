export const calendarKeys = {
  all: scope => ['calendar', scope],
  events: scope => [...calendarKeys.all(scope), 'events'],
  eventRange: (scope, start, end) => [...calendarKeys.events(scope), { start, end }],
};
