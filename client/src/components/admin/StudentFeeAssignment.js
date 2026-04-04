import React, { useState, useEffect, useCallback } from 'react';
import { PlusCircle, Trash2, AlertCircle, CheckCircle, Users, Tag } from 'lucide-react';

const API_BASE = '/api';
const authHeaders = () => {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
};

const R = (n) => `R ${Number(n || 0).toFixed(2)}`;
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date';

export default function StudentFeeAssignment() {
  const [fees, setFees] = useState([]);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [dueDate, setDueDate] = useState('');

  const loadFees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/student-fees`, { headers: authHeaders() });
      const data = await res.json();
      setFees(data.fees || []);
    } catch { setFees([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadFees();
    fetch(`${API_BASE}/admin/grades`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setGrades(d.grades || d || []))
      .catch(() => {});
  }, [loadFees]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !amount || parseFloat(amount) <= 0) {
      setFeedback({ type: 'error', message: 'Fee name and a valid amount are required' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/student-fees`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, amount: parseFloat(amount), grade_id: gradeId || null, due_date: dueDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setFeedback({ type: 'success', message: data.message });
      setName(''); setDescription(''); setAmount(''); setGradeId(''); setDueDate('');
      setShowForm(false);
      loadFees();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id, feeName) => {
    if (!window.confirm(`Remove the fee "${feeName}"? Parents will no longer see it.`)) return;
    try {
      const res = await fetch(`${API_BASE}/student-fees/${id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setFeedback({ type: 'success', message: `"${feeName}" has been removed.` });
      loadFees();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">One-Off Fees</h2>
          <p className="text-gray-400 text-sm mt-0.5">Create and assign custom fees such as zoo trips or fun days</p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setFeedback(null); }}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors"
        >
          <PlusCircle className="h-4 w-4" />
          {showForm ? 'Cancel' : 'Create Fee'}
        </button>
      </div>

      {feedback && (
        <div className={`flex items-start gap-3 rounded-xl p-4 text-sm border ${
          feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {feedback.type === 'success' ? <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" /> : <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />}
          {feedback.message}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <p className="text-sm font-bold text-gray-700">New One-Off Fee</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Fee Name *</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Grade 4 Zoo Trip"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Amount (R) *</label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description for parents"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Assign to Grade (auto-assigns all students in grade)</label>
              <select
                value={gradeId}
                onChange={e => setGradeId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">— Select grade (optional) —</option>
                {grades.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Due Date (optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-500 font-medium">Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Creating…' : 'Create & Assign'}
            </button>
          </div>
        </form>
      )}

      {/* Fees list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : fees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Tag className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No one-off fees created yet</p>
          <p className="text-gray-300 text-xs mt-1">Create a fee above to assign it to a grade or individual student</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="hidden sm:grid grid-cols-5 text-xs font-semibold text-gray-400 uppercase px-5 py-3 border-b border-gray-50 bg-gray-50">
            <span className="col-span-2">Fee Name</span>
            <span>Amount</span>
            <span>Assigned To</span>
            <span>Due / Actions</span>
          </div>
          <div className="divide-y divide-gray-50">
            {fees.map(fee => (
              <div key={fee.id} className="grid sm:grid-cols-5 items-center gap-2 px-5 py-4">
                <div className="sm:col-span-2">
                  <p className="text-sm font-semibold text-gray-800">{fee.name}</p>
                  {fee.description && <p className="text-xs text-gray-400 mt-0.5">{fee.description}</p>}
                </div>
                <p className="text-sm font-bold text-blue-600">{R(fee.amount)}</p>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Users className="h-3.5 w-3.5 text-gray-300" />
                  {fee.grade_name ? (
                    <span>{fee.grade_name} ({fee.assignment_count} student{fee.assignment_count !== 1 ? 's' : ''})</span>
                  ) : (
                    <span>{fee.assignment_count} student{fee.assignment_count !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{fmt(fee.due_date)}</span>
                  <button
                    onClick={() => handleDelete(fee.id, fee.name)}
                    className="ml-auto text-gray-300 hover:text-red-500 transition-colors"
                    title="Remove fee"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
