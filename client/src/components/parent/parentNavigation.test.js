import { getReturnDestination, getSafeParentDestination, parentLoginPath } from './parentNavigation';
import { verifyParentPushSubscription } from './ParentPortal';

describe('parent return-to safety', () => {
  test('preserves an allowlisted destination through login', () => {
    expect(parentLoginPath('/parent/notifications')).toBe('/parent/login?returnTo=%2Fparent%2Fnotifications');
    expect(getReturnDestination('?returnTo=%2Fparent%2Fattendance')).toBe('/parent/attendance');
  });

  test('rejects external and arbitrary destinations', () => {
    expect(getSafeParentDestination('https://example.com/steal')).toBeNull();
    expect(getSafeParentDestination('/admin/users')).toBeNull();
    expect(getReturnDestination('?returnTo=https%3A%2F%2Fexample.com')).toBe('/parent/dashboard');
  });

  test('does not allow the rollout-disabled Grades destination', () => {
    expect(getSafeParentDestination('/parent/grades')).toBeNull();
    expect(getReturnDestination('?returnTo=%2Fparent%2Fgrades')).toBe('/parent/dashboard');
    expect(parentLoginPath('/parent/grades')).toBe('/parent/login');
  });
});

describe('existing browser push subscription ownership', () => {
  test('revalidates an existing subscription through the authenticated endpoint', async () => {
    sessionStorage.setItem('parentToken', 'parent-token');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const subscription = { endpoint: 'https://push.example/subscription', keys: { p256dh: 'key' } };
    await verifyParentPushSubscription(subscription);
    expect(global.fetch).toHaveBeenCalledWith('/api/parent/push/subscribe', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ Authorization: 'Bearer parent-token' }),
      body: JSON.stringify({ subscription }),
    }));
  });

  test('exposes ownership conflict without claiming the subscription', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409 });
    await expect(verifyParentPushSubscription({ endpoint: 'https://push.example/existing' })).rejects.toMatchObject({ status: 409 });
  });
});