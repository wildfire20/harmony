/**
 * Contract assertion for remembered parent bootstrap:
 * refresh must hydrate /me before the portal can render its greeting/switcher.
 */
import { refreshParentAccess } from './ParentPortal';

test('refresh bootstrap hydrates parent identity and authorized child', async () => {
  sessionStorage.setItem('parentChild', JSON.stringify({ id: 2 }));
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'short-lived' }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        parent: { id: 9, first_name: 'Parent' },
        children: [{ id: 1, first_name: 'First' }],
      }),
    });

  await refreshParentAccess();
  expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/auth/refresh', expect.objectContaining({ credentials: 'include' }));
  expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/parent/me', expect.objectContaining({
    credentials: 'include',
    headers: { Authorization: 'Bearer short-lived' },
  }));
  expect(JSON.parse(sessionStorage.getItem('parentUser')).id).toBe(9);
  expect(JSON.parse(sessionStorage.getItem('parentChild')).id).toBe(1);
  expect(sessionStorage.getItem('parentToken')).toBe('short-lived');
  expect(localStorage.getItem('parentToken')).toBeNull();
});