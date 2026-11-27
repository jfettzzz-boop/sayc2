import { SERVICE_WORKER_URL, registerServiceWorker } from './pwa';

describe('registerServiceWorker', () => {
  const browser = (register: any) => ({ serviceWorker: { register } }) as unknown as Navigator;

  it('registers in a production browser build', async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    await expect(registerServiceWorker(true, false, browser(register))).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: './' });
  });

  it('stays out of development, the Android app and browsers without service workers', async () => {
    const register = vi.fn();
    await expect(registerServiceWorker(false, false, browser(register))).resolves.toBeNull();
    await expect(registerServiceWorker(true, true, browser(register))).resolves.toBeNull();
    await expect(registerServiceWorker(true, false, {} as Navigator)).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('lets the app run when registration fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const register = vi.fn().mockRejectedValue(new Error('blocked'));
    await expect(registerServiceWorker(true, false, browser(register))).resolves.toBeNull();
  });
});
