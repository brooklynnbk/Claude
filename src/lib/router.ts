export type Route = 'today' | 'todos' | 'calendar' | 'habits' | 'orders' | 'coach' | 'settings';

export const go = (route: Route, arg?: string) => {
  location.hash = `/${route}${arg ? `/${encodeURIComponent(arg)}` : ''}`;
};
