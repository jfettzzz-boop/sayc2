import { PUBLIC_PAGES, routes } from './app.routes';
import { authGuard, guestGuard } from './auth/auth.guard';

describe('routes', () => {
  const pages = routes.filter((route) => !route.redirectTo && !PUBLIC_PAGES.includes(route.path!));

  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages.map((route) => [route.path, route] as const))('%s requires a session', (_, route) => {
    expect(route.canActivate).toContain(authGuard);
  });

  it.each(PUBLIC_PAGES)('%s is open to visitors, and skipped once signed in', (path) => {
    const route = routes.find((r) => r.path === path)!;
    expect(route.canActivate).toEqual([guestGuard]);
  });

  it('opens on the landing page', () => {
    expect(routes.find((r) => r.path === '')!.redirectTo).toBe('welcome');
  });
});
