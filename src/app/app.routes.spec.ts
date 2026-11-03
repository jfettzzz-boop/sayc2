import { routes } from './app.routes';
import { authGuard } from './auth/auth.guard';

describe('routes', () => {
  const pages = routes.filter((route) => !route.redirectTo && route.path !== 'login');

  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages.map((route) => [route.path, route] as const))('%s requires a session', (_, route) => {
    expect(route.canActivate).toContain(authGuard);
  });
});
