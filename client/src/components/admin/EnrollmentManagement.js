import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, Bell, ChevronRight, Clock3, Download, FileCheck2, KeyRound, Mail, RefreshCw, ShieldCheck, X } from 'lucide-react';
import api, { adminAPI, enrollmentsAPI } from '../../services/api';
import { ADMISSIONS_STATUSES, statusLabel } from '../../data/admissionsStatuses';

const REQUEST_FIELDS = [
  ['parentEmail', 'Parent email'],
  ['parentPhone', 'Parent phone'],
  ['previousSchool', 'Previous school'],
  ['additionalNotes', 'Additional notes'],
];
const DOCUMENTS = [
  ['BIRTH_CERTIFICATE', 'Birth certificate'],
  ['PARENT_GUARDIAN_ID', 'Parent / guardian ID'],
  ['LATEST_SCHOOL_REPORT', 'Latest school report'],
  ['TRANSFER_DOCUMENT', 'Transfer document'],
];
const CHECKLIST_LABELS = {
  REGISTRATION_FORM: 'Registration form',
  BIRTH_CERTIFICATE: 'Birth certificate',
  PARENT_GUARDIAN_ID: 'Parent / guardian ID',
  LATEST_SCHOOL_REPORT: 'Latest school report',
  TRANSFER_DOCUMENT: 'Transfer document',
};
const CHECKLIST_STATES = {
  MISSING: 'Missing',
  BRING_IN_PERSON: 'Bring in person',
  RECEIVED: 'Received',
  NOT_APPLICABLE: 'Not applicable',
};
const ADMIN_CHECKLIST_STATES = [
  ['MISSING', 'Missing'],
  ['RECEIVED', 'Received'],
  ['NOT_APPLICABLE', 'Not applicable'],
];
const LINK_STATUSES = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  SUBMITTED_READ_ONLY: 'Submitted · read-only',
};

const badgeStyles = {
  NEW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  MORE_INFORMATION_REQUIRED: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  APPROVED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  REGISTRATION_PENDING: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  REGISTERED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  NOT_ACCEPTED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800', waitlisted: 'bg-blue-100 text-blue-800',
};
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const StatusBadge = ({ status }) => <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badgeStyles[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>{statusLabel(status)}</span>;
const MiniBadge = ({ children, tone = 'neutral' }) => <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === 'good' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : tone === 'warn' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{children}</span>;

const Section = ({ eyebrow, title, icon: Icon, children, action }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-700 dark:text-slate-300"><Icon size={16} /></span>
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p><h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3></div>
      </div>
      {action}
    </div>
    {children}
  </section>
);

const EnrollmentManagement = () => {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0 });
  const [filter, setFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedEnrollment, setSelectedEnrollment] = useState(null);
  const [nextStatus, setNextStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [parentMessage, setParentMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestFields, setRequestFields] = useState([]);
  const [requestDocuments, setRequestDocuments] = useState([]);
  const [requestNote, setRequestNote] = useState('');
  const [requestPreview, setRequestPreview] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activity, setActivity] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchEnrollments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/enrollments', { params: { status: filter || undefined, search: search || undefined } });
      setEnrollments(response.data.enrollments || []);
    } catch (error) { console.error(error); toast.error('Failed to fetch applications'); } finally { setLoading(false); }
  }, [filter, search]);
  const fetchStats = useCallback(async () => {
    try { const response = await enrollmentsAPI.getStats(); setStats(response.data); } catch (error) { console.error(error); }
  }, []);
  useEffect(() => { fetchEnrollments(); fetchStats(); }, [fetchEnrollments, fetchStats]);
  useEffect(() => {
    Promise.all([adminAPI.getNotifications({ limit: 8 }), adminAPI.getUnreadNotificationCount(), adminAPI.getAdmissionsActivity({ limit: 5 })])
      .then(([noteResponse, countResponse, activityResponse]) => {
        setNotifications(noteResponse.data.notifications || noteResponse.data || []);
        setUnreadCount(countResponse.data.unreadCount ?? countResponse.data.count ?? 0);
        setActivity(activityResponse.data.activity || activityResponse.data || []);
      }).catch(() => {});
  }, []);
  const markNotificationRead = async (notification) => {
    if (notification.readAt || notification.read) return;
    try { await adminAPI.markNotificationRead(notification.id); setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, read: true, readAt: new Date().toISOString() } : item)); setUnreadCount((count) => Math.max(0, count - 1)); } catch (error) { console.error(error); }
  };
  const markAllRead = async () => {
    try { await adminAPI.markAllNotificationsRead(); setNotifications((items) => items.map((item) => ({ ...item, read: true, readAt: new Date().toISOString() }))); setUnreadCount(0); } catch (error) { toast.error('Could not mark notifications read'); }
  };
  const documentAction = async (item, action) => {
    const documentItem = typeof item === 'string' ? checklist.find((entry) => entry.itemType === item) : item;
    try {
      const publicId = documentItem?.publicId || documentItem?.document?.publicId || documentItem?.file?.publicId;
      if (!publicId) return toast.error('This document has no secure public identifier');
      if (action === 'approve') {
        await enrollmentsAPI.reviewDocument(selectedEnrollment.id, publicId, { reviewStatus: 'RECEIVED' });
        toast.success('Document marked as received');
        await refreshDetail();
      } else if (action === 'reject') {
        const rejectionReason = window.prompt('Tell the parent what needs to be corrected:');
        if (!rejectionReason?.trim()) return;
        await enrollmentsAPI.reviewDocument(selectedEnrollment.id, publicId, { reviewStatus: 'REPLACEMENT_REQUIRED', rejectionReason: rejectionReason.trim() });
        toast.success('Replacement requested');
        await refreshDetail();
      } else { const response = await enrollmentsAPI.downloadDocument(selectedEnrollment.id, publicId);
        const contentType = item.document?.contentType || response.data?.type;
        const safeFilename = (item.document?.originalFilename || `${item.itemType}.${contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'pdf'}`).replace(/[^a-zA-Z0-9._ -]/g, '_');
        const url = URL.createObjectURL(response.data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeFilename; anchor.click(); URL.revokeObjectURL(url); }
    } catch (error) { toast.error('Secure document access is unavailable'); }
  };

  const openEnrollment = async (enrollment) => {
    try {
      const response = await enrollmentsAPI.getOne(enrollment.id);
      setSelectedEnrollment(response.data);
      setNextStatus(ADMISSIONS_STATUSES.some(({ value }) => value === response.data.status) ? response.data.status : '');
      setAdminNotes(response.data.admin_notes || '');
      setParentMessage('');
      setRequestOpen(false);
    } catch (error) { console.error(error); toast.error('Failed to open application'); }
  };
  const closeEnrollment = () => { setSelectedEnrollment(null); setRequestOpen(false); setRequestPreview(false); };
  const refreshDetail = async () => {
    const response = await enrollmentsAPI.getOne(selectedEnrollment.id);
    setSelectedEnrollment(response.data);
    fetchEnrollments();
    fetchStats();
  };
  const handleStatusUpdate = async () => {
    if (!nextStatus || nextStatus === selectedEnrollment.status) return toast('Choose a different status to save an update');
    if (nextStatus === 'MORE_INFORMATION_REQUIRED') return toast('Use Request more information to send a targeted request');
    try {
      setActionLoading(true);
      const response = await enrollmentsAPI.updateStatus(selectedEnrollment.id, { status: nextStatus, adminNotes, parentMessage });
      toast.success(`Application changed to ${statusLabel(nextStatus)}`);
      if (response.data.emailSent) toast.success('Parent status email sent');
      await refreshDetail();
    } catch (error) { toast.error(error.response?.data?.message || 'Failed to update status'); } finally { setActionLoading(false); }
  };
  const updateChecklist = async (itemType, status) => {
    try {
      setActionLoading(true);
      await enrollmentsAPI.updateChecklistItem(selectedEnrollment.id, itemType, { status });
      toast.success('Checklist updated');
      await refreshDetail();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update checklist');
    } finally { setActionLoading(false); }
  };
  const performLinkAction = async (purpose, action, label) => {
    const copy = action === 'resend'
      ? 'This reissues and replaces the existing link. The old link becomes invalid. Continue?'
      : action === 'reissue' ? 'This creates a new link and invalidates the current one. Continue?' : 'This immediately revokes the link. Continue?';
    if (!window.confirm(copy)) return;
    try {
      setActionLoading(true);
      await enrollmentsAPI[`${action}PortalLink`](selectedEnrollment.id, { purpose });
      toast.success(label);
      await refreshDetail();
    } catch (error) { toast.error(error.response?.data?.message || `Could not ${action} portal link`); } finally { setActionLoading(false); }
  };
  const submitInformationRequest = async () => {
    if (!requestFields.length && !requestDocuments.length) return toast.error('Select at least one field or document');
    try {
      setActionLoading(true);
      await enrollmentsAPI.requestInformation(selectedEnrollment.id, { requestedFields: requestFields, checklistItems: requestDocuments, parentMessage: requestNote.trim() || undefined });
      toast.success('Request for information sent');
      setRequestOpen(false); setRequestPreview(false); setRequestNote('');
      await refreshDetail();
    } catch (error) { toast.error(error.response?.data?.message || 'Could not send request'); } finally { setActionLoading(false); }
  };
  const runSearch = (event) => { event.preventDefault(); setSearch(searchInput.trim()); };
  const portal = selectedEnrollment?.portalData || selectedEnrollment?.portal_data || selectedEnrollment || {};
  const checklist = portal.checklist || [];
  const secureLinks = useMemo(() => {
    const value = portal.secureLinks || portal.secure_links || {};
    return Array.isArray(value) ? value : Object.entries(value).map(([purpose, details]) => ({ purpose, ...details }));
  }, [portal.secureLinks, portal.secure_links]);
  const latestEmail = (selectedEnrollment?.email_delivery || []).slice().sort((a, b) => new Date(b.created_at || b.sent_at || 0) - new Date(a.created_at || a.sent_at || 0))[0];
  const latestFailedEmail = (selectedEnrollment?.email_delivery || []).filter((item) => item.delivery_status === 'failed').sort((a, b) => new Date(b.created_at || b.sent_at || 0) - new Date(a.created_at || a.sent_at || 0))[0];
  const failedEmailType = latestFailedEmail?.email_type || latestFailedEmail?.type || latestFailedEmail?.template || '';
  const failedEmailNeedsSecureLink = ['status_more_information_required', 'status_approved'].includes(failedEmailType);
  const serviceSelections = portal.registration?.serviceSelections;
  const serviceSelectionText = serviceSelections && typeof serviceSelections === 'object'
    ? Object.entries(serviceSelections).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ')
    : Array.isArray(serviceSelections) ? serviceSelections.join(' · ') : '';

  return (
    <div className="p-6">
       <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row"><div><h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">Admissions Applications</h1><p className="text-slate-600 dark:text-slate-400">A focused view of decisions, parent follow-ups and registration readiness.</p></div><div className="relative"><button type="button" onClick={() => setShowNotifications((value) => !value)} className="relative flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"><Bell size={16} />Inbox{unreadCount > 0 && <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-pink-500 px-1.5 py-0.5 text-center text-[10px] text-white">{unreadCount}</span>}</button>{showNotifications && <div className="absolute right-0 z-20 mt-2 w-[min(90vw,360px)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800"><div className="flex items-center justify-between px-3 py-2"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent admissions activity</p><button type="button" onClick={markAllRead} className="text-xs font-semibold text-blue-700">Mark all read</button></div>{notifications.length ? notifications.map((item) => <button type="button" key={item.id} onClick={() => markNotificationRead(item)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${item.readAt || item.read ? 'text-slate-500' : 'bg-pink-50 font-semibold text-slate-800 dark:bg-pink-900/20 dark:text-white'}`}><span className="block">{item.title || item.message || 'Admissions update'}</span><small className="text-xs text-slate-400">{formatDateTime(item.createdAt || item.created_at)}</small></button>) : <p className="px-3 py-4 text-sm text-slate-500">No new activity.</p>}{activity.length > 0 && <p className="border-t border-slate-100 px-3 pb-1 pt-3 text-xs text-slate-500 dark:border-slate-700">{activity.length} recent admissions events shared with your team.</p>}</div>}</div></div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <button type="button" onClick={() => setFilter('')} className={`rounded-lg border p-3 text-left ${!filter ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}><span className="block text-xl font-bold dark:text-white">{stats.total || 0}</span><span className="text-xs text-slate-500">All</span></button>
        {ADMISSIONS_STATUSES.map(({ value, label }) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg border p-3 text-left ${filter === value ? 'border-pink-500 bg-pink-50 dark:bg-pink-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}><span className="block text-xl font-bold dark:text-white">{stats[value] || 0}</span><span className="text-xs text-slate-500">{label}</span></button>)}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <form onSubmit={runSearch} className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row dark:border-slate-700"><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="min-h-10 flex-1 rounded-lg border border-slate-300 px-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" placeholder="Search reference, learner, parent, email or phone" /><button className="min-h-10 rounded-lg bg-pink-500 px-5 font-medium text-white hover:bg-pink-600" type="submit">Search</button>{(search || searchInput) && <button type="button" onClick={() => { setSearchInput(''); setSearch(''); }} className="min-h-10 rounded-lg border border-slate-300 px-4 dark:border-slate-600 dark:text-white">Clear</button>}</form>
        {loading ? <div className="space-y-3 p-6"><div className="h-12 animate-pulse rounded bg-slate-100 dark:bg-slate-700" /><div className="h-12 animate-pulse rounded bg-slate-100 dark:bg-slate-700" /></div> : enrollments.length === 0 ? <div className="p-8 text-center text-slate-500">No applications found</div> : <div className="overflow-x-auto"><table className="w-full"><thead className="bg-slate-50 dark:bg-slate-900"><tr>{['Reference', 'Learner', 'Parent / contact', 'Applying for', 'Status', 'Applied', ''].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{enrollments.map((enrollment) => <tr key={enrollment.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50"><td className="px-4 py-4 font-mono text-sm font-bold text-blue-900 dark:text-blue-300">{enrollment.application_reference || `Legacy #${enrollment.id}`}</td><td className="px-4 py-4"><span className="font-medium text-slate-900 dark:text-white">{enrollment.student_first_name} {enrollment.student_last_name}</span></td><td className="px-4 py-4 text-sm"><p className="font-medium dark:text-white">{enrollment.parent_first_name} {enrollment.parent_last_name}</p><p className="text-slate-500">{enrollment.parent_email}</p><p className="text-slate-500">{enrollment.parent_phone}</p></td><td className="px-4 py-4 text-sm dark:text-white">{enrollment.grade_applying}{enrollment.boarding_option && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">Boarding</span>}</td><td className="px-4 py-4"><StatusBadge status={enrollment.status} /></td><td className="px-4 py-4 text-sm text-slate-500">{formatDate(enrollment.created_at)}</td><td className="px-4 py-4"><button type="button" onClick={() => openEnrollment(enrollment)} className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300">Open <ChevronRight size={14} className="inline" /></button></td></tr>)}</tbody></table></div>}
      </div>

      {selectedEnrollment && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true">
        <div className="modal-content max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <header className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-slate-50/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:px-6"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">{selectedEnrollment.application_reference || 'Admissions record'}</span><StatusBadge status={selectedEnrollment.status} /></div><h2 className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{selectedEnrollment.student_first_name} {selectedEnrollment.student_last_name}</h2><p className="text-sm text-slate-500">Grade {selectedEnrollment.grade_applying} · submitted {formatDate(selectedEnrollment.created_at)}</p></div><button type="button" onClick={closeEnrollment} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Close"><X size={20} /></button></header>
          <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1.35fr_0.85fr]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2"><Section eyebrow="Learner" title="Application snapshot" icon={FileCheck2}><p className="font-semibold text-slate-900 dark:text-white">{selectedEnrollment.student_first_name} {selectedEnrollment.student_last_name}</p><p className="text-sm text-slate-500">Date of birth: {formatDate(selectedEnrollment.student_date_of_birth)}</p><p className="text-sm text-slate-500">Applying for: {selectedEnrollment.grade_applying}</p>{selectedEnrollment.additional_notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">{selectedEnrollment.additional_notes}</p>}</Section><Section eyebrow="Parent / guardian" title="Contact" icon={Mail}><p className="font-semibold text-slate-900 dark:text-white">{selectedEnrollment.parent_first_name} {selectedEnrollment.parent_last_name}</p><p className="text-sm text-slate-500">{selectedEnrollment.parent_email}</p><p className="text-sm text-slate-500">{selectedEnrollment.parent_phone}</p></Section></div>
              <Section eyebrow="Read-only progress" title="Registration & requested information" icon={FileCheck2}><div className="grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Registration</p><div className="flex items-center gap-2"><MiniBadge tone={portal.registration?.formStatus === 'SUBMITTED' ? 'good' : 'warn'}>{portal.registration?.formStatus || 'Not started'}</MiniBadge>{portal.registration?.submittedAt && <span className="text-xs text-slate-500">{formatDate(portal.registration.submittedAt)}</span>}</div>{portal.registration?.formStatus === 'SUBMITTED' && <p className="mt-2 text-xs text-slate-500">Submitted forms are read-only. Admin cannot request edits here.</p>}</div><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Requested fields</p>{(portal.requestedFields || []).length ? <div className="flex flex-wrap gap-1.5">{portal.requestedFields.map((field) => <MiniBadge key={field}>{REQUEST_FIELDS.find(([key]) => key === field)?.[1] || field}</MiniBadge>)}</div> : <p className="text-sm text-slate-500">No open field request.</p>}</div></div>{serviceSelectionText && <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Service selections</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{serviceSelectionText}</p></div>}</Section>
              <Section eyebrow="Documents" title="Checklist status" icon={FileCheck2}><div className="grid gap-2 sm:grid-cols-2">{checklist.length ? checklist.map((item, index) => <div key={`${item.itemType}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900"><div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-700 dark:text-slate-200">{CHECKLIST_LABELS[item.itemType] || item.itemType}</span><MiniBadge tone={item.status === 'RECEIVED' ? 'good' : item.status === 'MISSING' ? 'warn' : 'neutral'}>{CHECKLIST_STATES[item.status] || item.status}</MiniBadge></div>{item.document && <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-900/20"><div className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-200"><ShieldCheck size={14} />{item.document.originalFilename} · {item.document.fileSize ? `${(item.document.fileSize / 1024 / 1024).toFixed(2)} MB` : 'Uploaded securely'}</div>{item.document.rejectionReason && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{item.document.rejectionReason}</p>}<div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => documentAction(item, 'download')} className="flex items-center gap-1 text-xs font-semibold text-slate-600"><Download size={12} />Download securely</button>{item.document.reviewStatus !== 'RECEIVED' && <button type="button" onClick={() => documentAction(item, 'approve')} className="text-xs font-semibold text-emerald-700">Mark received</button>}{item.document.reviewStatus !== 'REPLACEMENT_REQUIRED' && <button type="button" onClick={() => documentAction(item, 'reject')} className="text-xs font-semibold text-red-700">Request replacement</button>}</div></div>}<div className="mt-2 flex items-center gap-2"><select value={item.checklistStatus || item.status} disabled={actionLoading || Boolean(item.document)} onChange={(event) => updateChecklist(item.itemType, event.target.value)} className="min-h-8 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"><option value={item.checklistStatus || item.status}>{CHECKLIST_STATES[item.checklistStatus || item.status] || item.checklistStatus || item.status}</option>{ADMIN_CHECKLIST_STATES.filter(([value]) => value !== (item.checklistStatus || item.status)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{item.receivedAt && <span className="text-[11px] text-slate-400">Received {formatDate(item.receivedAt)}</span>}</div></div>) : <p className="text-sm text-slate-500">No checklist items returned.</p>}</div><p className="mt-3 text-xs text-slate-400">Document state is derived from the parent choice, upload receipt and admissions checklist. Secure actions never expose storage links.</p></Section>
              <Section eyebrow="Secure access" title="Parent-link status" icon={KeyRound}><div className="space-y-2">{secureLinks.length ? secureLinks.map((link, index) => <div key={`${link.purpose}-${index}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{String(link.purpose || 'Portal').replaceAll('_', ' ')}</p><p className="text-xs text-slate-500">Issued {formatDateTime(link.issuedAt || link.issued_at)} · used {link.useCount ?? link.use_count ?? 0} times</p></div><MiniBadge tone={link.status === 'ACTIVE' ? 'good' : link.status === 'EXPIRED' ? 'warn' : 'neutral'}>{LINK_STATUSES[link.status] || link.status || 'Unknown'}</MiniBadge></div><div className="mt-2 flex flex-wrap items-center gap-2">{link.status === 'SUBMITTED_READ_ONLY' ? <span className="text-xs text-slate-500">Submitted registration is read-only. Link cannot be resent or reissued.</span> : <><button type="button" disabled={actionLoading} onClick={() => performLinkAction(link.purpose, 'resend', 'Email sent with a new link')} className="rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/30">Resend email with new link</button><button type="button" disabled={actionLoading} onClick={() => performLinkAction(link.purpose, 'reissue', 'New link issued')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Reissue link</button></>}<button type="button" disabled={actionLoading} onClick={() => performLinkAction(link.purpose, 'revoke', 'Link revoked')} className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/30">Revoke</button></div></div>) : <p className="text-sm text-slate-500">No secure-link status returned.</p>}</div><p className="mt-3 text-xs text-slate-400">Resend email with new link replaces the old link; the old link becomes invalid. Links and tokens are never displayed.</p></Section>
            </div>
            <div className="space-y-4">
              <Section eyebrow="Decision" title="Update admissions status" icon={RefreshCw}><label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">New status<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">Select a status</option>{ADMISSIONS_STATUSES.filter(({ value }) => value !== 'MORE_INFORMATION_REQUIRED').map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label><p className="mt-2 text-xs text-slate-500">Use Request more information for targeted parent follow-up.</p><label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">Parent-safe message<textarea value={parentMessage} maxLength={1000} onChange={(event) => setParentMessage(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" placeholder="Only text suitable for the parent email" /></label><label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">Internal admin notes<textarea value={adminNotes} maxLength={4000} onChange={(event) => setAdminNotes(event.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" placeholder="Never included in parent emails" /></label><button type="button" onClick={handleStatusUpdate} disabled={actionLoading || !nextStatus || nextStatus === selectedEnrollment.status || nextStatus === 'MORE_INFORMATION_REQUIRED'} className="mt-3 w-full rounded-lg bg-pink-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-pink-600 disabled:opacity-50">{actionLoading ? 'Saving…' : 'Save status update'}</button></Section>
              <Section eyebrow="Parent follow-up" title="Request more information" icon={AlertCircle} action={requestOpen && <button type="button" onClick={() => { setRequestOpen(false); setRequestPreview(false); }} className="text-xs font-semibold text-slate-500">Close</button>}>{!requestOpen ? <><p className="text-sm text-slate-600 dark:text-slate-300">Ask only for the missing details and documents. Sending the request sets the application to More information required.</p><button type="button" onClick={() => setRequestOpen(true)} className="mt-3 w-full rounded-lg border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-800 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-900/20 dark:text-orange-200">Select information to request</button></> : requestPreview ? <div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"><p className="font-semibold dark:text-white">Request preview</p><p className="mt-2 text-slate-500">{requestFields.length ? requestFields.map((field) => REQUEST_FIELDS.find(([key]) => key === field)?.[1]).join(', ') : 'No fields'}{requestDocuments.length ? `${requestFields.length ? ' · ' : ''}${requestDocuments.map((doc) => DOCUMENTS.find(([key]) => key === doc)?.[1]).join(', ')}` : ''}</p>{requestNote && <p className="mt-2 border-t border-slate-200 pt-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">{requestNote}</p>}</div><p className="text-xs text-slate-500">The parent will receive this request. Review it before sending.</p><div className="flex gap-2"><button type="button" onClick={() => setRequestPreview(false)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:text-white">Back</button><button type="button" onClick={submitInformationRequest} disabled={actionLoading} className="flex-1 rounded-lg bg-pink-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{actionLoading ? 'Sending…' : 'Send request information'}</button></div></div> : <div className="space-y-3">{<fieldset><legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Requested fields</legend>{REQUEST_FIELDS.map(([key, label]) => <label key={key} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={requestFields.includes(key)} onChange={() => setRequestFields((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} className="h-4 w-4 rounded border-slate-300 text-pink-500" />{label}</label>)}</fieldset>}<fieldset><legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Documents</legend>{DOCUMENTS.map(([key, label]) => <label key={key} className="flex items-center gap-2 py-1 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={requestDocuments.includes(key)} onChange={() => setRequestDocuments((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} className="h-4 w-4 rounded border-slate-300 text-pink-500" />{label}</label>)}</fieldset><textarea value={requestNote} maxLength={1000} onChange={(event) => setRequestNote(event.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" placeholder="Optional parent-safe message" /><button type="button" onClick={() => setRequestPreview(true)} className="w-full rounded-lg bg-pink-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-pink-600">Preview request</button></div>}</Section>
              <Section eyebrow="Latest communication" title="Email delivery" icon={Mail}>{latestEmail ? <div className="flex gap-3"><span className={latestEmail.delivery_status === 'failed' ? 'text-red-500' : 'text-emerald-500'}><Mail size={18} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{latestEmail.delivery_status === 'failed' ? 'Delivery failed' : `Delivery ${latestEmail.delivery_status || 'recorded'}`}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(latestEmail.created_at || latestEmail.sent_at)}</p>{latestEmail.error_message && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{latestEmail.error_message}</p>}{latestFailedEmail && (failedEmailNeedsSecureLink ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">This failed {failedEmailType} email contains a secure link. Use “Resend email with new link” above to reissue it.</p> : failedEmailType ? <button type="button" disabled={actionLoading} onClick={async () => { if (!window.confirm('Resend this failed email?')) return; try { setActionLoading(true); await enrollmentsAPI.resendEmail(selectedEnrollment.id, { emailType: failedEmailType }); toast.success('Email resend requested'); await refreshDetail(); } catch (error) { toast.error(error.response?.data?.message || 'Could not resend email'); } finally { setActionLoading(false); } }} className="mt-2 rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300">Resend failed email</button> : <p className="mt-2 text-xs text-slate-500">Email type unavailable; no resend action is offered.</p>)}</div></div> : <p className="text-sm text-slate-500">No email delivery record returned.</p>}</Section>
              {selectedEnrollment.status_history?.length > 0 && <Section eyebrow="Audit trail" title="Status history" icon={Clock3}><div className="space-y-2">{selectedEnrollment.status_history.slice(0, 5).map((item, index) => <div key={`${item.created_at}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-900"><StatusBadge status={item.new_status} /><span className="text-xs text-slate-500">{formatDate(item.created_at)}</span></div>)}</div></Section>}
            </div>
          </div>
          <footer className="flex justify-end border-t border-slate-200 px-5 py-4 dark:border-slate-700"><button type="button" onClick={closeEnrollment} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-white">Close</button></footer>
        </div>
      </div>}
    </div>
  );
};

export default EnrollmentManagement;