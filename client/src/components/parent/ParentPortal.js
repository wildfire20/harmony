import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  Home, CalendarDays, Bell, CreditCard, FolderOpen,
  LogOut, Menu, X, ChevronDown, ChevronRight, Users, BellRing, Settings2
} from 'lucide-react';
import ParentDashboard from './ParentDashboard';
import ParentAttendance from './ParentAttendance';
import ParentAnnouncements from './ParentAnnouncements';
import ParentInvoices from './ParentInvoices';
import ParentDocuments from './ParentDocuments';
import ParentAccount from './ParentAccount';
import ParentNotifications from './ParentNotifications';
import ParentCalendar from './ParentCalendar';
import { getSafeParentDestination, parentLoginPath } from './parentNavigation';
import './ParentPortal.css';

const NAV = [
  { path: '/parent/dashboard',      label: 'Home',        icon: Home },
  { path: '/parent/calendar',       label: 'Calendar',    icon: CalendarDays },
  { path: '/parent/attendance',     label: 'Attendance',  icon: CalendarDays },
  { path: '/parent/announcements',  label: 'Notices',     icon: Bell },
  { path: '/parent/documents',      label: 'Documents',   icon: FolderOpen },
  { path: '/parent/invoices',       label: 'Fees',        icon: CreditCard },
  { path: '/parent/account',        label: 'Account',      icon: Settings2 },
];
const MOBILE_NAV_PATHS = new Set([
  '/parent/dashboard',
  '/parent/calendar',
  '/parent/attendance',
  '/parent/announcements',
  '/parent/documents',
  '/parent/invoices',
]);
const MOBILE_MENU_NAV = [
  ...NAV,
  { path: '/parent/notifications', label: 'Notifications', icon: BellRing },
];

// ─── Auth helper ─────────────────────────────────────────────────────────────
export const useParentAuth = () => {
  const storage = sessionStorage;
  const token    = storage.getItem('parentToken');
  const parse = (key, fallback) => {
    try { return JSON.parse(storage.getItem(key) || fallback); } catch (_) { return JSON.parse(fallback); }
  };
  const user     = parse('parentUser', 'null');
  const children = parse('parentChildren', '[]');
  const child    = parse('parentChild', 'null');
  return { token, user, children, child, isAuthenticated: !!token };
};

// ─── API helper (auto-injects auth + child_id) ────────────────────────────────
export const parentApi = async (path, opts = {}) => {
  const { skipChildId, ...requestOptions } = opts;
  const storage = sessionStorage;
  const token = storage.getItem('parentToken');
  let selected = null;
  try { selected = JSON.parse(storage.getItem('parentChild') || 'null'); } catch (_) {}
  const requestPath = skipChildId || path.includes('child_id=') || !selected?.id
    ? path
    : `${path}${path.includes('?') ? '&' : '?'}child_id=${encodeURIComponent(selected.id)}`;
  const request = (authToken) => fetch(`/api/parent${requestPath}`, {
    ...requestOptions, credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(opts.headers || {}) },
  });
  let res = await request(token);
  if (res.status === 401) {
    try { res = await request(await refreshParentAccess()); }
    catch (_) {
      const destination = getSafeParentDestination(`${window.location.pathname}${window.location.search}`);
      sessionStorage.clear();
      window.location.href = parentLoginPath(destination);
      return null;
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Request failed');
  }
  return res.json();
};

// ─── Child context ────────────────────────────────────────────────────────────
export const ChildContext = createContext({ child: null, children: [], onSelectChild: () => {} });
export const useSelectedChild = () => useContext(ChildContext);

let parentRefreshPromise = null;
export const refreshParentAccess = () => {
  if (!parentRefreshPromise) parentRefreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.message || 'Session expired');
      sessionStorage.setItem('parentToken', d.token);

      // Hydrate the identity and authorized learner list while the refresh
      // response is still current. Never trust a stale selected child.
      const me = await fetch('/api/parent/me', {
        credentials: 'include',
        headers: { Authorization: `Bearer ${d.token}` },
      });
      const profile = await me.json().catch(() => ({}));
      if (!me.ok) throw new Error(profile.message || 'Unable to load parent profile');
      const children = profile.children || [];
      let previous = null;
      try { previous = JSON.parse(sessionStorage.getItem('parentChild') || 'null'); } catch (_) {}
      const rememberedChildId = Number(localStorage.getItem('parentSelectedChildId')) || null;
      const selected = children.find(child => child.id === previous?.id) ||
        children.find(child => child.id === rememberedChildId) || children[0] || null;
      if (profile.parent) sessionStorage.setItem('parentUser', JSON.stringify(profile.parent));
      sessionStorage.setItem('parentChildren', JSON.stringify(children));
      if (selected) {
        sessionStorage.setItem('parentChild', JSON.stringify(selected));
        localStorage.setItem('parentSelectedChildId', String(selected.id));
      } else {
        sessionStorage.removeItem('parentChild');
        localStorage.removeItem('parentSelectedChildId');
      }
      return d.token;
    })
    .catch((error) => {
      ['parentToken', 'parentUser', 'parentChildren', 'parentChild'].forEach(key => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      });
      throw error;
    })
    .finally(() => { parentRefreshPromise = null; });
  return parentRefreshPromise;
};

// ─── Child Switcher ───────────────────────────────────────────────────────────
const ChildSwitcher = ({ children, selectedChild, onSelect }) => {
  const [open, setOpen] = useState(false);
  if (!children || children.length <= 1) {
    return selectedChild ? (
      <div className="hidden md:flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
        <div className="w-6 h-6 rounded-full bg-[#8fc4c3] text-[#17324d] flex items-center justify-center text-xs font-bold">
          {selectedChild.first_name?.[0]}{selectedChild.last_name?.[0]}
        </div>
        <span className="text-sm text-white font-medium">{selectedChild.first_name} {selectedChild.last_name}</span>
        <span className="text-[#b9d5d4] text-xs">• {selectedChild.grade_name}</span>
      </div>
    ) : null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="hidden md:flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-[#8fc4c3] text-[#17324d] flex items-center justify-center text-xs font-bold">
          {selectedChild?.first_name?.[0]}{selectedChild?.last_name?.[0]}
        </div>
        <span className="text-sm text-white font-medium">{selectedChild?.first_name} {selectedChild?.last_name}</span>
        <span className="text-[#b9d5d4] text-xs">• {selectedChild?.grade_name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#b9d5d4]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
            <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-50">
              Switch Child
            </p>
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => { onSelect(child); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#e8f1ef] transition-colors ${
                  selectedChild?.id === child.id ? 'bg-[#e8f1ef]' : ''
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-[#dceef0] flex items-center justify-center text-xs font-bold text-[#2c7475] shrink-0">
                  {child.first_name?.[0]}{child.last_name?.[0]}
                </div>
                <div className="text-left">
                  <p className="text-gray-800 text-sm font-medium">{child.first_name} {child.last_name}</p>
                  <p className="text-gray-400 text-xs">{child.grade_name} • {child.student_number}</p>
                </div>
                {selectedChild?.id === child.id && (
                  <div className="ml-auto w-2 h-2 rounded-full bg-[#2c7475]" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Push Notification Hook ───────────────────────────────────────────────────
export const verifyParentPushSubscription = async (subscription) => {
  const token = sessionStorage.getItem('parentToken');
  const response = await fetch('/api/parent/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ subscription }),
  });
  if (!response.ok) {
    const error = new Error('Push subscription could not be verified');
    error.status = response.status;
    throw error;
  }
  return response;
};

const usePushNotifications = (enabled = true) => {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [ownershipConflict, setOwnershipConflict] = useState(false);

  const verifySubscription = async (subscription) => {
    try {
      await verifyParentPushSubscription(subscription);
      setOwnershipConflict(false);
      setSubscribed(true);
    } catch (error) {
      if (error.status === 403 || error.status === 409) {
        setOwnershipConflict(true);
        setSubscribed(false);
      }
      throw error;
    }
  };

  const subscribe = async () => {
    if (!enabled) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const keyRes = await fetch('/api/parent/vapid-key');
      const { publicKey } = await keyRes.json();
      if (!publicKey) return;

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await verifySubscription(existing);
        return;
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await verifySubscription(sub);
    } catch (err) {
      console.error('Push subscribe error:', err);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      if (sub) verifySubscription(sub).catch(() => {});
    });
  }, [enabled]);

  return { permission, subscribed, ownershipConflict, subscribe };
};

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
};

// ─── Main Portal ─────────────────────────────────────────────────────────────
const ParentPortal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, children, isAuthenticated } = useParentAuth();
  const [, setAuthVersion] = useState(0);
  const [bootstrapping, setBootstrapping] = useState(!isAuthenticated);
  const [selectedChild, setSelectedChild] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('parentChild') || 'null'); } catch (_) { return null; }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileChildOpen, setMobileChildOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notifDismissed, setNotifDismissed] = useState(
    () => localStorage.getItem('notifBannerDismissed') === '1'
  );
  const { permission, subscribed, ownershipConflict, subscribe } = usePushNotifications(isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      refreshParentAccess().catch(() => {}).finally(() => {
        setBootstrapping(false);
        if (sessionStorage.getItem('parentToken')) {
          try { setSelectedChild(JSON.parse(sessionStorage.getItem('parentChild') || 'null')); }
          catch (_) { setSelectedChild(null); }
          setAuthVersion(version => version + 1);
        }
        else navigate(parentLoginPath(getSafeParentDestination(`${location.pathname}${location.search}`)), { replace: true });
      });
    } else setBootstrapping(false);
  }, [isAuthenticated, navigate]);

  // Refresh children data from the server so enrollment flag changes are reflected immediately
  useEffect(() => {
    if (!isAuthenticated) return;
    const storage = sessionStorage;
    const token = storage.getItem('parentToken');
    fetch('/api/parent/me', { credentials: 'include', headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const freshChildren = data.children || [];
        storage.setItem('parentChildren', JSON.stringify(freshChildren));
        // Update selectedChild with fresh data that includes up-to-date enrollment flags
        setSelectedChild(prev => {
          if (freshChildren.length === 0) {
            storage.removeItem('parentChild');
            localStorage.removeItem('parentChild');
            return null;
          }
          const refreshed = freshChildren.find(c => c.id === (prev?.id || freshChildren[0]?.id));
          // Keep the current learner only when it is still linked. If an
          // unlink occurred, fall back to the first learner returned by the
          // server rather than restoring stale local state.
          const updated = refreshed || freshChildren[0];
          storage.setItem('parentChild', JSON.stringify(updated));
          return updated;
        });
      })
      .catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshUnreadCount = () => parentApi('/notifications/unread-count', { skipChildId: true })
      .then((data) => setUnreadNotificationCount(Number(data?.count ?? data?.unread_count ?? data ?? 0)))
      .catch(() => {});
    refreshUnreadCount();
    window.addEventListener('parent-notifications-updated', refreshUnreadCount);
    return () => window.removeEventListener('parent-notifications-updated', refreshUnreadCount);
  }, [isAuthenticated, location.pathname]);

  if (bootstrapping || !isAuthenticated) return null;

  const handleSelectChild = (child) => {
    setSelectedChild(child);
    sessionStorage.setItem('parentChild', JSON.stringify(child));
    localStorage.setItem('parentSelectedChildId', String(child.id));
  };

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}).finally(() => {
      sessionStorage.clear();
      ['parentToken', 'parentUser', 'parentChildren', 'parentChild', 'parentSelectedChildId'].forEach(key => localStorage.removeItem(key));
      navigate('/parent/login', { replace: true });
    });
  };

  const isActive = (path) => location.pathname === path;

  return (
    <ChildContext.Provider value={{ child: selectedChild, children, onSelectChild: handleSelectChild }}>
      <div className="parent-portal min-h-[100dvh] bg-[#f4f7f5] flex flex-col text-[#334b5d]">
        {/* Top bar */}
        <header className="parent-mobile-header sticky top-0 z-30 border-b border-white/10 bg-[#19324a] text-white shadow-[0_8px_22px_rgba(25,50,74,.18)]">
          <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2 shrink-0">
               <div className="grid h-9 w-9 place-items-center rounded-xl bg-white p-1"><img src="/images/harmony-logo.png" alt="" className="max-h-full max-w-full object-contain" /></div>
               <div><span className="block text-sm font-bold tracking-tight">Harmony Learning</span><span className="block text-[10px] uppercase tracking-[0.18em] text-[#b9d5d4]">Parent portal</span></div>
            </div>

            {/* Child switcher (desktop) */}
            <ChildSwitcher
              children={children}
              selectedChild={selectedChild}
              onSelect={handleSelectChild}
            />

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => navigate('/parent/notifications')}
                aria-label="View notifications"
                className="parent-header-action grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span className="relative"><Bell className="h-5 w-5" />{unreadNotificationCount > 0 && <span aria-label={`${unreadNotificationCount} unread notifications`} className="absolute -right-2 -top-2 grid min-h-[17px] min-w-[17px] place-items-center rounded-full bg-[#e86e5b] px-1 text-[10px] font-bold text-white">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}</span>
              </button>
              <button
                onClick={handleLogout}
                className="parent-header-signout hidden sm:flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              <button
                className="parent-header-action sm:hidden p-1.5 rounded-lg hover:bg-white/10"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
               <div className="parent-mobile-menu sm:hidden border-t border-[#dce6ea]">
              {/* Child switcher for mobile */}
              {children && children.length > 0 && (
                <div className="border-b border-[#dce6ea]">
                  <button
                    onClick={() => setMobileChildOpen(!mobileChildOpen)}
                    className="parent-child-switcher w-full flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                       <div className="parent-avatar w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold">
                        {selectedChild?.first_name?.[0]}{selectedChild?.last_name?.[0]}
                      </div>
                      <div className="min-w-0 text-left">
                         <p className="parent-menu-title truncate font-medium text-sm">{selectedChild?.first_name} {selectedChild?.last_name}</p>
                         <p className="parent-menu-muted text-xs">{selectedChild?.grade_name}</p>
                      </div>
                    </div>
                    {children.length > 1 && (
                       <div className="parent-menu-muted flex items-center gap-1 text-xs">
                        <Users className="h-3.5 w-3.5" />
                        Switch
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mobileChildOpen ? 'rotate-180' : ''}`} />
                      </div>
                    )}
                  </button>
                  {mobileChildOpen && children.length > 1 && (
                     <div className="parent-child-list border-t">
                      {children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => { handleSelectChild(child); setMobileChildOpen(false); setMobileMenuOpen(false); }}
                           className={`parent-child-row w-full flex items-center gap-3 px-5 py-2.5 ${selectedChild?.id === child.id ? 'parent-child-row-active' : ''}`}
                        >
                           <div className="parent-avatar w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">
                            {child.first_name?.[0]}{child.last_name?.[0]}
                          </div>
                          <div className="min-w-0 text-left">
                             <p className="parent-menu-title truncate text-sm">{child.first_name} {child.last_name}</p>
                             <p className="parent-menu-muted text-xs">{child.grade_name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {MOBILE_MENU_NAV.map(({ path, label, icon: Icon }) => (
                <button
                  key={path}
                  onClick={() => { navigate(path); setMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                     isActive(path) ? 'parent-menu-active' : 'parent-menu-item'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <ChevronRight className="h-3.5 w-3.5 ml-auto" />
                </button>
              ))}
              <button
                onClick={handleLogout}
                 className="parent-signout w-full flex items-center gap-3 px-4 py-3 text-sm border-t"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </header>

        {/* Push notification banner */}
        {!subscribed && !notifDismissed && permission !== 'denied' && permission !== 'unsupported' && 'PushManager' in window && (
           <div className="parent-notification-banner px-4 py-2.5 flex items-center gap-3 justify-center text-sm">
             <BellRing className="h-4 w-4 shrink-0" />
             <span>{ownershipConflict ? 'This browser notification is linked to another account. You can enable notifications from a different browser profile.' : 'Get notified when new notices or documents are shared'}</span>
            {!ownershipConflict && <button
              onClick={subscribe}
               className="ml-1 bg-white text-[#176b73] font-semibold text-xs px-3 py-1 rounded-full hover:bg-[#e8f1ef] transition-colors shrink-0"
            >
              Enable
            </button>}
            <button
              onClick={() => { setNotifDismissed(true); localStorage.setItem('notifBannerDismissed', '1'); }}
               className="text-[#617487] hover:text-[#19324a] transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex w-full max-w-6xl flex-1 mx-auto">
          {/* Sidebar (desktop) */}
          <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-[#dce7eb] px-4 pb-8 pt-7 sm:flex">
            {NAV.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive(path)
                    ? 'bg-[#176b73] text-white shadow-md shadow-[#176b73]/20'
                    : 'text-[#617487] hover:bg-[#e8f1ef]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </aside>

          {/* Main content */}
          <main className="min-w-0 flex-1 p-4 pb-24 sm:p-7 sm:pb-10">
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard"     element={<ParentDashboard  child={selectedChild} user={user} />} />
              <Route path="attendance"    element={<ParentAttendance child={selectedChild} />} />
              <Route path="calendar"      element={<ParentCalendar />} />
               <Route path="grades"        element={<Navigate to="/parent/dashboard" replace />} />
              <Route path="announcements" element={<ParentAnnouncements child={selectedChild} />} />
              <Route path="notifications"  element={<ParentNotifications />} />
              <Route path="documents"       element={<ParentDocuments     child={selectedChild} />} />
              <Route path="invoices"        element={<ParentInvoices      child={selectedChild} />} />
              <Route path="account"         element={<ParentAccount user={user} children={children} selectedChild={selectedChild} onSelectChild={handleSelectChild} onLogout={handleLogout} />} />
              <Route path="payment-proof"   element={<Navigate to="/parent/invoices" replace />} />
            </Routes>
          </main>
        </div>

        {/* Bottom nav (mobile) */}
        <nav className="parent-mobile-bottom-nav fixed bottom-0 left-0 right-0 z-20 flex border-t border-[#dce7eb] bg-[#fbfcfa]/95 shadow-[0_-8px_25px_rgba(31,65,83,.12)] backdrop-blur sm:hidden">
           {NAV.filter(({ path }) => MOBILE_NAV_PATHS.has(path)).map(({ path, label, icon: Icon }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
                className={`parent-mobile-bottom-item flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-colors ${
                  isActive(path) ? 'text-[#176b73]' : 'text-[#84929e]'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive(path) ? 'text-[#176b73]' : 'text-[#84929e]'}`} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sm:hidden h-16" />
      </div>
    </ChildContext.Provider>
  );
};

export default ParentPortal;
