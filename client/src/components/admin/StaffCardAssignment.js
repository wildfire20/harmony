import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CreditCard, UserCheck, Trash2, Search, CheckCircle, AlertCircle, Loader, ScanLine, ExternalLink } from 'lucide-react';
import { useTheme } from '../common/ThemeProvider';

const roleLabel = (role) => {
  if (role === 'non_teaching_staff') return 'Support Staff';
  if (role === 'super_admin') return 'Super Admin';
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
};

const StaffCardAssignment = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [assignments, setAssignments] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({ user_id: '', card_id: '' });
  const [scanning, setScanning] = useState(false);
  const scanBufferRef = useRef('');
  const scanInputRef = useRef(null);

  const token = localStorage.getItem('token');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [cardsRes, staffRes] = await Promise.all([
        fetch('/api/staff-attendance/cards', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/teachers', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const cardsData = await cardsRes.json();
      const staffData = await staffRes.json();

      if (cardsData.success) setAssignments(cardsData.cards);

      const users = staffData.teachers || staffData.users || staffData || [];
      setAllStaff(Array.isArray(users) ? users : []);
    } catch {
      showToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Scanner keyboard capture when scan mode is active
  const handleScanKey = useCallback((e) => {
    if (!scanning) return;
    if (e.key === 'Enter') {
      const val = scanBufferRef.current.trim();
      scanBufferRef.current = '';
      if (val) {
        setForm(f => ({ ...f, card_id: val }));
        setScanning(false);
        showToast(`Card captured: ${val}`, 'success');
      }
    } else if (e.key.length === 1) {
      scanBufferRef.current += e.key;
    }
  }, [scanning]);

  useEffect(() => {
    if (scanning) {
      scanBufferRef.current = '';
      if (scanInputRef.current) scanInputRef.current.focus();
      window.addEventListener('keydown', handleScanKey);
    } else {
      window.removeEventListener('keydown', handleScanKey);
    }
    return () => window.removeEventListener('keydown', handleScanKey);
  }, [scanning, handleScanKey]);

  const handleAssign = async (e) => {
    e.preventDefault();
    if (!form.user_id || !form.card_id.trim()) {
      showToast('Please select a staff member and provide a card ID', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/staff-attendance/assign-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: parseInt(form.user_id), card_id: form.card_id.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Card assigned successfully');
        setForm({ user_id: '', card_id: '' });
        fetchData();
      } else {
        showToast(data.message || 'Assignment failed', 'error');
      }
    } catch {
      showToast('Server error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (userId, name) => {
    if (!window.confirm(`Remove card from ${name}?`)) return;
    try {
      const res = await fetch(`/api/staff-attendance/cards/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        showToast('Card removed');
        fetchData();
      } else {
        showToast(data.message || 'Failed to remove', 'error');
      }
    } catch {
      showToast('Server error', 'error');
    }
  };

  const filteredAssignments = assignments.filter(a =>
    `${a.first_name} ${a.last_name} ${a.card_id} ${a.email}`.toLowerCase().includes(search.toLowerCase())
  );

  const card = isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100';
  const inputClass = `w-full px-3 py-2.5 rounded-xl border text-sm ${
    isDark ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
  } focus:outline-none focus:ring-2 focus:ring-blue-500`;

  return (
    <div className="space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Scanning station link */}
      <div className={`rounded-2xl border p-4 flex items-center justify-between ${card}`}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl">
            <ScanLine className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Scanning Station</p>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Open the full-screen kiosk view for the reception desk</p>
          </div>
        </div>
        <a
          href="/staff-scan"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Open Station
        </a>
      </div>

      {/* Assign card form */}
      <div className={`rounded-2xl border p-6 ${card}`}>
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 bg-gradient-to-br from-red-500 to-red-600 rounded-xl">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Assign Card to Staff</h2>
        </div>

        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Staff Member</label>
            <select
              value={form.user_id}
              onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
              className={inputClass}
              required
            >
              <option value="">Select staff member…</option>
              {allStaff.map(s => (
                <option key={s.id} value={s.id}>
                  {s.first_name} {s.last_name} ({roleLabel(s.role)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Card ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.card_id}
                onChange={e => setForm(f => ({ ...f, card_id: e.target.value }))}
                placeholder="Type or scan a card ID…"
                className={`${inputClass} flex-1`}
                ref={scanInputRef}
              />
              <button
                type="button"
                onClick={() => setScanning(s => !s)}
                className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  scanning
                    ? 'bg-amber-500 border-amber-500 text-white animate-pulse'
                    : isDark
                      ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600'
                      : 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <ScanLine className="w-4 h-4" />
                {scanning ? 'Waiting…' : 'Scan'}
              </button>
            </div>
            {scanning && (
              <p className="mt-1.5 text-amber-500 text-xs animate-pulse">Scan the card now — scanner input will be captured</p>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl font-semibold text-sm hover:from-red-700 hover:to-red-800 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <Loader className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Assign Card'}
          </button>
        </form>
      </div>

      {/* Assignments list */}
      <div className={`rounded-2xl border ${card}`}>
        <div className="p-5 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: isDark ? '#374151' : '#f3f4f6' }}>
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Assigned Cards <span className={`text-sm font-normal ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>({assignments.length})</span>
          </h2>
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={`pl-9 pr-3 py-2 rounded-xl border text-sm w-48 ${
                isDark ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filteredAssignments.length === 0 ? (
          <div className={`text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No card assignments found</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: isDark ? '#374151' : '#f3f4f6' }}>
            {filteredAssignments.map(a => (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                  isDark ? 'bg-blue-900 text-blue-300' : 'bg-blue-100 text-blue-700'
                }`}>
                  {a.first_name[0]}{a.last_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {a.first_name} {a.last_name}
                  </p>
                  <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'} truncate`}>
                    {roleLabel(a.role)} · {a.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium ${
                    isDark ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {a.card_id}
                  </span>
                  <button
                    onClick={() => handleRemove(a.user_id, `${a.first_name} ${a.last_name}`)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDark ? 'text-gray-500 hover:text-red-400 hover:bg-red-900/30' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                    }`}
                    title="Remove card"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffCardAssignment;
