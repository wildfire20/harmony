import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
  UserPlus, Trash2, Edit2, Search, Users, AlertCircle, X,
  RefreshCw, Phone, Copy, RotateCcw, Plus, Minus, Share2, Link2
} from 'lucide-react';

const ParentManagement = () => {
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingParent, setEditingParent] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [tempPassResult, setTempPassResult] = useState(null);
  const [showPass, setShowPass] = useState(false);

  // Student search for form
  const [studentSearch, setStudentSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [linkedStudents, setLinkedStudents] = useState([]); // list of {id, name, student_number}

  const emptyForm = { first_name: '', last_name: '', phone_number: '', email: '' };
  const [form, setForm] = useState(emptyForm);

  const loadParents = async () => {
    try {
      const res = await api.get('/parent/admin/list');
      setParents(res.data.parents || []);
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
        const { tempPassword, isExisting } = res.data;
        if (tempPassword) {
          setTempPassResult({ phone: form.phone_number, password: tempPassword });
        } else if (isExisting) {
          toast.success('Students added to existing parent account');
          setShowForm(false);
          loadParents();
        }
        if (tempPassword) loadParents(); // refresh but keep modal to show password
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
    if (!window.confirm(`Reset password for ${parent.first_name} ${parent.last_name}? They will need to set a new password on next login.`)) return;
    try {
      const res = await api.post(`/parent/admin/reset-password/${parent.id}`);
      setTempPassResult({ phone: parent.phone_number, password: res.data.tempPassword });
      toast.success('Password reset. Share the temporary password with the parent.');
    } catch {
      toast.error('Failed to reset password');
    }
  };

  const handleSyncEnrollments = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/parent/admin/sync-enrollments');
      const { created, linked, skipped } = res.data;
      toast.success(`Sync complete: ${created} new accounts, ${linked} links added, ${skipped} skipped`);
      loadParents();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied!'));
  };

  const filtered = parents.filter((p) => {
    const q = filterText.toLowerCase();
    return (
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
            onClick={handleSyncEnrollments}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors text-sm disabled:opacity-60"
            title="Auto-create parent accounts from approved enrollment applications"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Enrollments'}
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            <UserPlus className="h-4 w-4" />
            Add Parent
          </button>
        </div>
      </div>

      {/* Shareable welcome link info */}
      {(() => {
        const welcomeUrl = `${window.location.origin}/parent/welcome`;
        return (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
              <Share2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-emerald-800 font-semibold text-sm">Share this link with parents</p>
              <p className="text-emerald-700 text-xs mt-0.5 mb-2">
                Post this in your school WhatsApp group. Parents enter their phone number to receive their temporary password — no staff involvement needed.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="bg-white border border-emerald-200 rounded-lg px-3 py-1.5 text-sm font-mono text-emerald-800 break-all">
                  {welcomeUrl}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(welcomeUrl); toast.success('Link copied!'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors shrink-0"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Link
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Welcome to Harmony Learning Institute's Parent Portal!\n\nUse this link to get your login password:\n${welcomeUrl}\n\nEnter your phone number and your temporary password will appear on screen.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors shrink-0"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share on WhatsApp
                </a>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Search */}
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

      {/* Temp password result panel */}
      {tempPassResult && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="font-bold text-amber-800 text-base">Parent account created!</p>
              <p className="text-amber-700 text-sm">The parent can get their password in two ways:</p>
            </div>
            <button
              onClick={() => { setTempPassResult(null); setShowForm(false); }}
              className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Option 1: Welcome link */}
          <div className="bg-white border border-amber-200 rounded-xl p-3 mb-3">
            <p className="text-amber-800 text-xs font-semibold mb-1.5 uppercase tracking-wide">Option 1 – Share the welcome link (recommended)</p>
            <p className="text-amber-700 text-xs mb-2">The parent visits this link, enters their phone number, and sees their password themselves:</p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-xs font-mono text-amber-800 break-all flex-1">
                {window.location.origin}/parent/welcome
              </code>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/parent/welcome`)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 shrink-0"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
          </div>

          {/* Option 2: Manual */}
          <div className="bg-white border border-amber-200 rounded-xl p-3">
            <p className="text-amber-800 text-xs font-semibold mb-1.5 uppercase tracking-wide">Option 2 – Tell them directly</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-amber-600 text-xs w-20 shrink-0">Phone:</span>
                <code className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 font-mono text-sm flex-1">{tempPassResult.phone}</code>
                <button onClick={() => copyToClipboard(tempPassResult.phone)} className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg shrink-0"><Copy className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-amber-600 text-xs w-20 shrink-0">Password:</span>
                <code className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 font-mono text-sm font-bold tracking-wide flex-1">{tempPassResult.password}</code>
                <button onClick={() => copyToClipboard(tempPassResult.password)} className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg shrink-0"><Copy className="h-3.5 w-3.5" /></button>
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
