const PARENT_DESTINATIONS = new Set([
  '/parent/dashboard',
  '/parent/attendance',
  '/parent/invoices',
  '/parent/payment-proof',
  '/parent/documents',
  '/parent/announcements',
  '/parent/notifications',
]);

export const getSafeParentDestination = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || !PARENT_DESTINATIONS.has(parsed.pathname)) return null;
    return parsed.pathname;
  } catch (_) {
    return null;
  }
};

export const parentLoginPath = (destination) => {
  const safeDestination = getSafeParentDestination(destination);
  return safeDestination ? `/parent/login?returnTo=${encodeURIComponent(safeDestination)}` : '/parent/login';
};

export const getReturnDestination = (search) => {
  const params = new URLSearchParams(search || '');
  return getSafeParentDestination(params.get('returnTo')) || '/parent/dashboard';
};

export const isAllowlistedParentDestination = (value) => Boolean(getSafeParentDestination(value));