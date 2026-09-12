import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
  UserPlus, Trash2, Edit2, Search, Users, AlertCircle, X,
  Phone, Copy, RotateCcw, Plus, Minus, Share2, Link2
  ,ShieldCheck, ShieldOff, Mail
} from 'lucide-react';

const ParentManagement = () => {
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingParent, setEditingParent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [metrics, setMetrics] = useState({});
  const [tempPassResult, setTempPassResult] = useState(null);
  const [showPass, setShowPass] = useState(false);

  // Student search for form
  const [studentSearch, setStudentSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [linkedStudents, setLinkedStudents] = useState([]); // list of {id, name, student_number}

  const emptyForm = { first_name: '', last_name: '', phone_number: '', email: '' };
  const [form, setForm] = useState(emptyForm);
  const portalStatus = (p) => {
    if (['NOT_INVITED', 'INVITE_SENT', 'ACTIVATED', 'DISABLED'].includes(p.portal_status)) return p.portal_status;
    if (p.parent_account_status === 'disabled' || p.is_active === false) return 'DISABLED';
    if (p.activated_at || p.parent_activation_state === 'active' || p.portal_status === 'activated' || p.portal_active) return 'ACTIVATED';
    if (p.invitation_sent_at || p.invited_at || p.portal_status === 'invite_sent') return 'INVITE_SENT';
    return 'NOT_INVITED';
  };

  const loadParents = async () => {
    try {
      const res = await api.get('/parent/admin/list');
      setParents(res.data.parents || []);
      setMetrics(res.data.metrics || {});
    } catch {
      toast.error('Failed to load parent accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadParents(); }, []);

  useEffect(() => {
    if (studentSearch.length < 2) { setStudents([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/admin/students?search=${encodeURIComponent(studentSearch)}&limit=10`);
        const all = res.data.students || [];
        setStudents(all.filter(s => !linkedStudents.find(l => l.id === s.id)));
      } catch { /* ignore */ }
    }, 350);
    return () => clearTimeout(t);
  }, [studentSearch, linkedStudents]);

  const openCreate = () => {
    setEditingParent(null);
    setForm(emptyForm);
    setLinkedStudents([]);
    setStudentSearch('');
    setStudents([]);
    setTempPassResult(null);
    setShowForm(true);
  };

  const openEdit = (p) => {
    setEditingParent(p);
    setForm({
      first_name:   p.first_name,
      last_name:    p.last_name,
      phone_number: p.phone_number || '',
      email:        p.email || '',
    });
    setLinkedStudents(
      (p.children || []).map(c => ({
        id:             c.child_id,
        first_name:     c.child_name?.split(' ')[0] || '',
        last_name:      c.child_name?.split(' ').slice(1).join(' ') || '',
        student_number: c.child_student_number,
        name:           c.child_name,
      }))
    );
    setStudentSearch('');
    setStudents([]);
    setTempPassResult(null);
    setShowForm(true);
  };

  const addStudent = (s) => {
    setLinkedStudents(prev => [...prev, s]);
    setStudentSearch('');
    setStudents([]);
  };

  const removeStudent = (id) => {
    setLinkedStudents(prev => prev.filter(s => s.id !== id));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.phone_number) return toast.error('Phone number is required');
    if (linkedStudents.length === 0) return toast.error('Please link at least one student');

    setSubmitting(true);
    try {
      if (editingParent) {
        const originalIds = (editingParent.children || []).map(c => c.child_id);
        const newIds      = linkedStudents.map(s => s.id);
        const toAdd       = newIds.filter(id => !originalIds.includes(id));
        const toRemove    = originalIds.filter(id => !newIds.includes(id));

        await api.put(`/parent/admin/${editingParent.id}`, {
          ...form,
          add_student_ids:    toAdd,
          remove_student_ids: toRemove,
        });
        toast.success('Parent account updated');
        setShowForm(false);
        loadParents();
      } else {
        const res = await api.post('/parent/admin/create', {
          ...form,
          student_ids: linkedStudents.map(s => s.id),
        });
        const { activationLink, isExisting } = res.data;
        if (activationLink) {
          setTempPassResult({ link: activationLink });
        } else if (isExisting) {
          toast.success('Students added to existing parent account');
          setShowForm(false);
          loadParents();
        }
        if (activationLink) loadParents(); // refresh but keep modal to show handoff link
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (parent) => {
    if (!window.confirm(`Delete account for ${parent.first_name} ${parent.last_name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/parent/admin/${parent.id}`);
      toast.success('Parent account deleted');
      loadParents();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleResetPassword = async (parent) => {
    if (!window.confirm(`Reset portal access for ${parent.first_name} ${parent.last_name}?`)) return;
    try {
      const res = await api.post(`/parent/admin/reset-password/${parent.id}`);
      if (res.data?.resetLink) copyToClipboard(res.data.resetLink);
      toast.success('Reset link generated and copied');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reset parent access');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied!'));
  };

  const parentAction = async (parent, action, success) => {
    if (!window.confirm(`${action === 'disable' ? 'Disable' : action === 'enable' ? 'Re-enable' : action === 'reset-access' ? 'Reset portal access for' : 'Send an invitation to'} ${parent.first_name} ${parent.last_name}?`)) return;
    try {
      const endpoint = action === 'invitation' ? (parent.invitation_sent_at ? 'reissue' : 'invite') : action;
      const res = action === 'reset-access'
        ? await api.post(`/parent/admin/reset-password/${parent.id}`)
        : await api.post(`/parent/admin/${parent.id}/${endpoint}`);
      if (res.data?.activationLink) copyToClipboard(res.data.activationLink);
      if (res.data?.resetLink) copyToClipboard(res.data.resetLink);
      toast.success(success || 'Action completed');
      loadParents();
    } catch (err) { toast.error(err.response?.data?.message || 'Action could not be completed'); }
  };

  const filtered = parents.filter((p) => {
    const q = filterText.toLowerCase();
    return (statusFilter === 'ALL' || p.rollout_status === statusFilter) && (
      p.first_name?.toLowerCase().includes(q) ||
      p.last_name?.toLowerCase().includes(q) ||
      p.phone_number?.includes(q) ||
      p.children?.some(c =>
        c.child_name?.toLowerCase().includes(q) ||
        c.child_student_number?.toLowerCase().includes(q)
      )
    );
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Parent Accounts</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Parents log in at <span className="font-mono bg-gray-100 px-1 rounded text-xs">/parent/login</span> using their phone number
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            <UserPlus className="h-4 w-4" />
            Add Parent
          </button>
        </div>
      </div>

      {/* Search */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Parent Portal rollout</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{metrics.activated || 0} / {metrics.total || 0} activated</h3>
            <p className="text-sm text-slate-500">{metrics.activation_percentage || 0}% activation</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{metrics.activated_today || 0} activated today</p>
            <p>{metrics.activated_this_week || 0} in the last 7 days</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, metrics.activation_percentage || 0)}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ['Total Parents', metrics.total, 'text-slate-900'],
            ['Activated', metrics.activated, 'text-emerald-700'],
            ['Awaiting Activation', metrics.awaiting_activation, 'text-amber-700'],
            ['Ready to Activate', metrics.ready_to_activate, 'text-blue-700'],
            ['Needs Attention', metrics.needs_attention, 'text-red-700'],
            ['Disabled', metrics.disabled, 'text-slate-600'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <p className={`text-xl font-bold ${tone}`}>{value || 0}</p>
              <p className="mt-1 text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>Never activated: {metrics.never_activated || 0}</span>
          <span>Email verified: {metrics.email_verified || 0}</span>
          <span>Email missing: {metrics.email_missing || 0}</span>
          <span>Multi-learner Parents: {metrics.multi_learner_parents || 0}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
        <h3 className="font-semibold text-blue-950">Self-activation instructions</h3>
        <p className="mt-1 text-sm text-blue-800">Parents visit the website, open Parent Portal, select Activate your account, enter their registered mobile and email, verify the emailed OTP, then create a password.</p>
        <button type="button" onClick={() => copyToClipboard('Visit the Harmony Learning Institute website and open Parent Portal. Select “Activate your account”, enter the mobile number registered with the school and your email address, enter the OTP sent by email, then create your password.')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm">
          <Copy className="h-3.5 w-3.5" /> Copy instructions
        </button>
      </section>

      <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, phone number or student…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>
        <select aria-label="Filter by rollout status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm">
          <option value="ALL">All rollout statuses</option>
          {['ACTIVATED', 'READY_TO_ACTIVATE', 'INVALID_MOBILE', 'MISSING_MOBILE', 'DUPLICATE_MOBILE', 'DISABLED', 'NEEDS_REVIEW'].map(status => (
            <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Temp password result panel */}
      {tempPassResult && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="font-bold text-amber-800 text-base">Parent account created!</p>
              <p className="text-amber-700 text-sm">This one-time activation handoff is shown only once. Share it securely.</p>
            </div>
            <button
              onClick={() => { setTempPassResult(null); setShowForm(false); }}
              className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="bg-white border border-amber-200 rounded-xl p-3">
              <p className="text-amber-800 text-xs font-semibold mb-1.5 uppercase tracking-wide">One-time activation link</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                  <span className="text-amber-600 text-xs w-20 shrink-0">Link:</span>
                  <code className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 font-mono text-xs flex-1 break-all">{tempPassResult.link}</code>
                  <button onClick={() => copyToClipboard(tempPassResult.link)} className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg shrink-0"><Copy className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && !tempPassResult && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{editingParent ? 'Edit Parent Account' : 'New Parent Account'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                  <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
                  <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
              </div>

              {/* Phone (primary ID) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Phone Number * <span className="text-gray-400 font-normal">(used for login)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="tel"
                    value={form.phone_number}
                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                    placeholder="e.g. 071 167 9620"
                    className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                {!editingParent && (
                  <p className="text-xs text-blue-600 mt-1">
                    If this phone number is already registered, the students will simply be added to that account.
                  </p>
                )}
              </div>

              {/* Email (optional) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="parent@example.com"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Linked students */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  Linked Children * <span className="text-gray-400 font-normal">(you can link more than one)</span>
                </label>

                {/* Already-linked list */}
                {linkedStudents.length > 0 && (
                  <div className="mb-2 space-y-1.5">
                    {linkedStudents.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                        <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-bold text-emerald-700">
                          {s.first_name?.[0]}{s.last_name?.[0]}
                        </div>
                        <span className="text-emerald-700 text-sm font-medium flex-1">
                          {s.first_name || s.name?.split(' ')[0]} {s.last_name || s.name?.split(' ').slice(1).join(' ')}
                          <span className="text-emerald-500 font-normal ml-1 text-xs">({s.student_number || s.id})</span>
                        </span>
                        <button type="button" onClick={() => removeStudent(s.id)} className="text-emerald-600 hover:text-red-500">
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Student search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Search student to add…"
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                {students.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    {students.slice(0, 6).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => addStudent(s)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0 text-left"
                      >
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                          {s.first_name?.[0]}{s.last_name?.[0]}
                        </div>
                        <div>
                          <p className="text-gray-800 text-sm font-medium">{s.first_name} {s.last_name}</p>
                          <p className="text-gray-400 text-xs">{s.student_number}</p>
                        </div>
                        <Plus className="h-4 w-4 text-blue-500 ml-auto" />
                      </button>
                    ))}
                  </div>
                )}
                {studentSearch.length >= 2 && students.length === 0 && (
                  <p className="text-gray-400 text-xs mt-1 ml-1">No students found</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 text-sm disabled:opacity-60">
                  {submitting ? 'Saving…' : editingParent ? 'Update' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">
            {parents.length === 0 ? 'No parent accounts yet' : 'No results match your search'}
          </p>
          {parents.length === 0 && (
            <p className="text-gray-400 text-xs mt-1">Click "Add Parent" or use "Sync from Enrollments" to get started</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start gap-4 justify-between flex-wrap">
                {/* Parent info */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 shrink-0">
                    {p.first_name?.[0]}{p.last_name?.[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800">{p.first_name} {p.last_name}</p>
                      {p.must_change_password && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Temp password</span>
                      )}
                      {!p.is_active && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Inactive</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-500 text-xs mt-0.5">
                      <Phone className="h-3 w-3" />
                      {p.phone_number || <span className="text-red-400">No phone</span>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded-full ${p.rollout_status === 'ACTIVATED' ? 'bg-emerald-100 text-emerald-700' : ['DISABLED', 'INVALID_MOBILE', 'MISSING_MOBILE', 'DUPLICATE_MOBILE', 'NEEDS_REVIEW'].includes(p.rollout_status) ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{(p.rollout_status || portalStatus(p)).replaceAll('_', ' ')}</span>
                      <span>{p.linked_learner_count || 0} linked learner{p.linked_learner_count === 1 ? '' : 's'}</span>
                      <span>Email: {(p.email_status || 'MISSING').toLowerCase()}</span>
                      <span>Account: {(p.account_state || 'ACTIVE').toLowerCase()}</span>
                      {(p.invitation_sent_at || p.invited_at) && <span>Invited {new Date(p.invitation_sent_at || p.invited_at).toLocaleDateString()}</span>}
                      {(p.last_login_at || p.lastLoginAt) && <span>Last login {new Date(p.last_login_at || p.lastLoginAt).toLocaleDateString()}</span>}
                    </div>
                    {p.activation_history?.[0] && (
                      <p className="mt-2 text-xs text-slate-500">
                        Activated {new Date(p.activation_history[0].activated_at).toLocaleString()} via {p.activation_history[0].method === 'SELF_EMAIL_OTP' ? 'Self Activation' : 'Admin-assisted activation'} · Email {p.activation_history[0].email_verified ? 'verified' : 'not verified'}
                      </p>
                    )}

                    {/* Children list */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(p.children || []).length === 0 ? (
                        <span className="text-amber-500 text-xs flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> No students linked
                        </span>
                      ) : (
                        (p.children || []).map((c) => (
                          <span key={c.child_id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                            {c.child_name} • {c.child_grade}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => parentAction(p, p.is_active === false ? 'enable' : 'disable', p.is_active === false ? 'Parent re-enabled' : 'Parent disabled')} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium ${p.is_active === false ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                    {p.is_active === false ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}{p.is_active === false ? 'Re-enable' : 'Disable'}
                  </button>
                  <button disabled={!p.email} title={!p.email ? 'Add an email address before sending an invitation' : 'Admin-assisted activation'} onClick={() => parentAction(p, 'invitation', 'Invitation sent')} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg font-medium disabled:cursor-not-allowed disabled:opacity-40"><Mail className="h-3.5 w-3.5" />{p.invitation_sent_at ? 'Reissue Invitation' : 'Send Invitation'}</button>
                  <button onClick={async () => { try { const res = await api.post(`/parent/admin/${p.id}/copy-link`); if (res.data?.activationLink) copyToClipboard(res.data.activationLink); else toast.error('No activation link was returned'); } catch (err) { toast.error(err.response?.data?.message || 'Could not generate activation link'); } }} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg font-medium"><Link2 className="h-3.5 w-3.5" />Generate/Copy Link</button>
                  <button onClick={() => parentAction(p, 'reset-access', 'Parent access reset')} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg font-medium"><RotateCcw className="h-3.5 w-3.5" />Reset Access</button>
                  <button
                    onClick={() => handleResetPassword(p)}
                    title="Reset password"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg font-medium"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Pass
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg font-medium"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ParentManagement;
