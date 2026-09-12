import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, Bell, BookOpen, CalendarDays, Check,
  CreditCard, FileText, Megaphone, RefreshCw
} from 'lucide-react';
import { parentApi, useSelectedChild } from './ParentPortal';

const ACTIONS = {
  attendance: { label: 'View attendance', path: '/parent/attendance' },
  payments: { label: 'View fees', path: '/parent/invoices' },
  invoices: { label: 'View fees', path: '/parent/invoices' },
  documents: { label: 'View documents', path: '/parent/documents' },
  announcements: { label: 'View notice', path: '/parent/announcements' },
  home: { label: 'View home', path: '/parent/dashboard' },
  notifications: { label: 'View notifications', path: '/parent/notifications' },
};

const CATEGORIES = {
  attendance: { label: 'Attendance', Icon: CalendarDays, tone: 'bg-[#e8f1ef] text-[#176b73]' },
  academic: { label: 'Academics', Icon: BookOpen, tone: 'bg-[#eaf0fa] text-[#315d9a]' },
  grades: { label: 'Academics', Icon: BookOpen, tone: 'bg-[#eaf0fa] text-[#315d9a]' },
  payment: { label: 'Fees', Icon: CreditCard, tone: 'bg-[#fff2df] text-[#a85f18]' },
  payments: { label: 'Fees', Icon: CreditCard, tone: 'bg-[#fff2df] text-[#a85f18]' },
  document: { label: 'Documents', Icon: FileText, tone: 'bg-[#f0ebf7] text-[#765595]' },
  documents: { label: 'Documents', Icon: FileText, tone: 'bg-[#f0ebf7] text-[#765595]' },
  announcement: { label: 'Notice', Icon: Megaphone, tone: 'bg-[#fcebea] text-[#ad5147]' },
  announcements: { label: 'Notice', Icon: Megaphone, tone: 'bg-[#fcebea] text-[#ad5147]' },
};

export const getNotificationAction = (notification) => {
  const candidates = [notification?.action, notification?.safe_action, notification?.category, notification?.type]
    .map((value) => String(value || '').toLowerCase());
  return candidates.map((candidate) => ACTIONS[candidate]).find(Boolean) || null;
};

const categoryFor = (notification) => {
  const key = String(notification?.category || notification?.type || '').toLowerCase();
  return CATEGORIES[key] || { label: 'Update', Icon: Bell, tone: 'bg-[#edf2f2] text-[#617487]' };
};

const learnerName = (notification) => {
  if (notification?.learner_name) return notification.learner_name;
  if (notification?.learner?.first_name) return `${notification.learner.first_name} ${notification.learner.last_name || ''}`.trim();
  return null;
};

const formatTime = (value) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
};

const NotificationCard = ({ notification, onRead, onAction }) => {
  const category = categoryFor(notification);
  const action = getNotificationAction(notification);
  const Icon = category.Icon;
  const unread = !notification.read_at && notification.read !== true && notification.is_read !== true;
  const learner = learnerName(notification);
  return (
    <article className={`relative rounded-2xl border p-4 transition-colors ${unread ? 'border-[#b8d8d2] bg-[#fbfefd]' : 'border-[#e3ebeb] bg-white'}`}>
      {unread && <span className="absolute left-0 top-5 h-8 w-1 rounded-r-full bg-[#e86e5b]" aria-label="Unread" />}
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${category.tone}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#71838e]">{category.label}</p>
              <h2 className={`mt-1 text-sm leading-snug ${unread ? 'font-bold text-[#19324a]' : 'font-semibold text-[#405666]'}`}>{notification.title || 'A new update is available'}</h2>
            </div>
            {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#e86e5b]" />}
          </div>
          {learner && <p className="mt-2 text-xs font-semibold text-[#176b73]">For {learner}</p>}
          {notification.summary && <p className="mt-1.5 text-sm leading-relaxed text-[#6b7d87]">{notification.summary}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <time className="text-xs text-[#91a0a8]" dateTime={notification.created_at}>{formatTime(notification.created_at)}</time>
            {unread && (
              <button type="button" onClick={() => onRead(notification.id)} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#176b73] hover:bg-[#e8f1ef]">
                <Check className="h-3.5 w-3.5" /> Mark read
              </button>
            )}
            {action && (
              <button type="button" onClick={() => onAction(action.path, notification)} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-[#176b73] px-3 text-xs font-bold text-white hover:bg-[#125b62]">
                {action.label} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

const ParentNotifications = () => {
  const navigate = useNavigate();
  const { children, onSelectChild } = useSelectedChild();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    return Promise.all([
      parentApi('/notifications', { skipChildId: true }),
      parentApi('/notifications/unread-count', { skipChildId: true }),
    ]).then(([list, count]) => {
      const rows = Array.isArray(list) ? list : (list?.notifications || []);
      setNotifications(rows);
      setUnreadCount(Number(count?.count ?? count?.unread_count ?? count ?? rows.filter((item) => !item.read_at && item.read !== true).length));
    }).catch((err) => setError(err.message || 'We could not load notifications.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = (id) => {
    setSaving(true);
    parentApi(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT', skipChildId: true })
      .then(() => {
        setNotifications((items) => items.map((item) => item.id === id ? { ...item, read: true, read_at: new Date().toISOString() } : item));
        setUnreadCount((count) => Math.max(0, count - 1));
        window.dispatchEvent(new CustomEvent('parent-notifications-updated'));
      }).catch((err) => setError(err.message || 'Could not mark this update as read.')).finally(() => setSaving(false));
  };

  const markAllRead = () => {
    if (!unreadCount) return;
    setSaving(true);
    parentApi('/notifications/read-all', { method: 'PUT', skipChildId: true })
      .then(() => {
        setNotifications((items) => items.map((item) => ({ ...item, read: true, read_at: item.read_at || new Date().toISOString() })));
        setUnreadCount(0);
        window.dispatchEvent(new CustomEvent('parent-notifications-updated'));
      }).catch((err) => setError(err.message || 'Could not mark updates as read.')).finally(() => setSaving(false));
  };

  const openNotification = (path, notification) => {
    if (notification?.learner_id) {
      const authorizedLearner = children.find((child) => Number(child.id) === Number(notification.learner_id));
      if (!authorizedLearner) {
        setError('This learner is no longer linked to your account.');
        return;
      }
      onSelectChild(authorizedLearner);
    }
    navigate(path);
  };

  const content = useMemo(() => {
    if (loading) return <div className="space-y-3" aria-label="Loading notifications">{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-[#dfe9e7]" />)}</div>;
    if (!notifications.length) return <div className="rounded-3xl border border-dashed border-[#cbdcda] bg-white px-6 py-14 text-center"><Bell className="mx-auto h-9 w-9 text-[#9ab6b2]" /><h2 className="mt-4 text-lg font-bold text-[#19324a]">You’re all caught up</h2><p className="mx-auto mt-1 max-w-sm text-sm text-[#71838e]">New updates about your learners will appear here.</p></div>;
    return <div className="space-y-3">{notifications.map((notification) => <NotificationCard key={notification.id} notification={notification} onRead={markRead} onAction={openNotification} />)}</div>;
  }, [loading, notifications, children]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b5473a]">Parent inbox</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#19324a]">Notifications</h1><p className="mt-1 text-sm text-[#71838e]">A simple record of what changed for your learners.</p></div>
        {!!unreadCount && <button disabled={saving} onClick={markAllRead} className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl border border-[#b8d8d2] bg-white px-3 text-xs font-bold text-[#176b73] hover:bg-[#e8f1ef] disabled:opacity-50"><Check className="h-4 w-4" /> <span className="hidden sm:inline">Mark all read</span><span className="sm:hidden">Read all</span></button>}
      </div>
      {error && <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-5 w-5 shrink-0" /><span className="flex-1">{error}</span><button onClick={load} className="inline-flex items-center gap-1 font-bold"><RefreshCw className="h-4 w-4" /> Retry</button></div>}
      {content}
    </div>
  );
};

export default ParentNotifications;