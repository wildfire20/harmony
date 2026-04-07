import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Pencil, Power, Loader, CheckCircle, AlertCircle,
  Search, CreditCard, X, Eye, EyeOff
} from 'lucide-react';
import { useTheme } from '../common/ThemeProvider';

const API = (path, opts = {}) => {
  const token = localStorage.getItem('token');
  return fetch(path, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }).then(r => r.json());
};

const EMPTY_FORM = { first_name: '', last_name: '', job_title: '', phone_number: '', email: '' };

const NonTeachingStaffManager = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [modal, setModal] = useState(null); // null | 'add' | { mode:'edit', member }
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [createdPassword, setCreatedPassword] = useState(null);
  const [showPwd, setShowPwd] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const data = await API('/api/staff-attendance/non-teaching');
    if (data.success) setStaff(data.staff);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setForm(EMPTY_FORM); setCreatedPassword(null); setModal('add'); };
  const openEdit = (m) => { setForm({ first_name: m.first_name, last_name: m.last_name, job_title: m.job_title || '', phone_number: m.phone_number || '', email: '' }); setModal({ mode: 'edit', member: m }); };
  const closeModal = () => { setModal(null); setCreatedPassword(null); setShowPwd(false); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal === 'add') {
        const res = await API('/api/staff-attendance/non-teaching', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        if (res.success) {
          setCreatedPassword(res.temp_password);
          await load();
          showToast(`${form.first_name} ${form.last_name} added successfully`);
        } else {
          showToast(res.message || 'Failed to create staff member', 'error');
        }
      } else {
        const res = await API(`/api/staff-attendance/non-teaching/${modal.member.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        if (res.success) {
          closeModal();
          await load();
          showToast('Staff member updated');
        } else {
          showToast(res.message || 'Failed to update', 'error');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (member) => {
    const res = await API(`/api/staff-attendance/non-teaching/${member.id}/toggle`, { method: 'PATCH' });
    if (res.success) {
      await load();
      showToast(res.message);
    } else {
      showToast(res.message || 'Failed', 'error');
    }
  };

  const filtered = staff.filter(m => {
    if (!showInactive && !m.is_active) return false;
    const q = search.toLowerCase();
    return (
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      (m.job_title || '').toLowerCase().includes(q) ||
      (m.phone_number || '').includes(q)
    );
  });

  const card = isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200';
  const inputCls = `w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    isDark ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
  }`;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className={`rounded-2xl border p-5 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Support Staff</h2>
            <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Non-teaching staff members who use the sign-in kiosk
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl text-sm font-semibold hover:from-red-700 hover:to-red-800 transition-all shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            Add Support Staff
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mt-4">
          <div className="relative flex-1 min-w-48">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search by name or position…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`${inputCls} pl-9`}
            />
          </div>
          <label className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm select-none ${
            isDark ? 'border-gray-700 text-gray-300' : 'border-gray-200 text-gray-600'
          }`}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-2xl border overflow-hidden ${card}`}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className={`text-center py-16 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            <UserPlus className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No support staff found</p>
            <p className="text-xs mt-1">Click "Add Support Staff" to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-gray-800' : 'bg-gray-50'}>
                  {['Name', 'Position', 'Phone', 'Card', 'Status', 'Actions'].map(h => (
                    <th key={h} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-gray-800' : 'divide-gray-100'}`}>
                {filtered.map(m => (
                  <tr key={m.id} className={`${!m.is_active ? 'opacity-50' : ''} ${isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50/80'} transition-colors`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          isDark ? 'bg-purple-900 text-purple-300' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {m.first_name[0]}{m.last_name[0]}
                        </div>
                        <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {m.first_name} {m.last_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${
                        isDark ? 'bg-purple-900/40 text-purple-300' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {m.job_title || '—'}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {m.phone_number || <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {m.card_id ? (
                        <span className={`flex items-center gap-1.5 text-xs font-mono ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                          <CreditCard className="w-3.5 h-3.5" />
                          {m.card_id}
                        </span>
                      ) : (
                        <span className={`text-xs italic ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>No card</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.is_active
                          ? isDark ? 'bg-green-900/40 text-green-400' : 'bg-green-100 text-green-700'
                          : isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEdit(m)}
                          className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggle(m)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            m.is_active
                              ? isDark ? 'text-red-400 hover:text-red-300 hover:bg-red-900/30' : 'text-red-500 hover:text-red-700 hover:bg-red-50'
                              : isDark ? 'text-green-400 hover:text-green-300 hover:bg-green-900/30' : 'text-green-600 hover:text-green-700 hover:bg-green-50'
                          }`}
                          title={m.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-md rounded-2xl shadow-2xl border ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: isDark ? '#374151' : '#f3f4f6' }}>
              <h3 className={`font-bold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {modal === 'add' ? 'Add Support Staff' : 'Edit Staff Member'}
              </h3>
              <button onClick={closeModal} className={`p-1.5 rounded-lg ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Password display after creation */}
            {createdPassword && (
              <div className={`mx-5 mt-5 p-4 rounded-xl border ${isDark ? 'bg-green-900/20 border-green-700 text-green-300' : 'bg-green-50 border-green-200 text-green-800'}`}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1.5 opacity-70">Temporary Password</p>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-bold tracking-wider flex-1">
                    {showPwd ? createdPassword : '••••••••••••'}
                  </span>
                  <button onClick={() => setShowPwd(v => !v)} className="opacity-60 hover:opacity-100">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs mt-2 opacity-70">Write this down — it won't be shown again. You can reset it from Password Management.</p>
              </div>
            )}

            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>First Name *</label>
                  <input required value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} className={inputCls} placeholder="First name" />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Last Name *</label>
                  <input required value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} className={inputCls} placeholder="Last name" />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Position / Job Title *</label>
                <input required value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} className={inputCls} placeholder="e.g. Security Guard, Janitor, Cook" />
              </div>

              <div>
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Phone Number</label>
                <input value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} className={inputCls} placeholder="e.g. 0821234567" />
              </div>

              {modal === 'add' && (
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Email (optional)</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="Leave blank to auto-generate" />
                  <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Only required if they need to log into the system. A password will be generated.</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  isDark ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}>
                  {createdPassword ? 'Close' : 'Cancel'}
                </button>
                {!createdPassword && (
                  <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl text-sm font-semibold hover:from-red-700 hover:to-red-800 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                    {saving ? <Loader className="w-4 h-4 animate-spin" /> : null}
                    {saving ? 'Saving…' : modal === 'add' ? 'Add Staff Member' : 'Save Changes'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default NonTeachingStaffManager;
