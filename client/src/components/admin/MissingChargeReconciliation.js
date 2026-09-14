import React, { useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const SERVICES = [
  ['tuition', 'Tuition'],
  ['boarding', 'Boarding'],
  ['transport', 'Transport'],
  ['aftercare', 'Aftercare'],
];

const MissingChargeReconciliation = () => {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [learner, setLearner] = useState(null);
  const [service, setService] = useState('boarding');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async (value) => {
    setQuery(value);
    setLearner(null);
    if (value.trim().length < 2) return setResults([]);
    try {
      const response = await fetch(`/api/enhanced-invoices/search-students?q=${encodeURIComponent(value.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setResults(response.ok ? data.students || [] : []);
    } catch (_) {
      setResults([]);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!learner || !period || !Number.isFinite(numericAmount) || numericAmount <= 0 || reason.trim().length < 10) {
      return toast.error('Select a learner and enter a valid period, amount, and reason.');
    }
    const label = SERVICES.find(([key]) => key === service)?.[1] || service;
    if (!window.confirm(`Create an authoritative ${label} charge of R${numericAmount.toFixed(2)} for ${learner.fullName} for ${period}? This action is audited.`)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/invoices/reconcile-missing-charge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: learner.id,
          service_key: service,
          billing_period: period,
          amount: numericAmount,
          reason: reason.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not reconcile the charge');
      toast.success(data.message);
      setAmount('');
      setReason('');
    } catch (error) {
      toast.error(error.message || 'Could not reconcile the charge');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
      <div className="flex items-start gap-3 mb-6">
        <div className="p-2 rounded-xl bg-amber-100 text-amber-700"><ShieldCheck className="h-5 w-5" /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Reconcile Missing Charge</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">Use only after confirming a service should have been billed. This creates a new audited ledger charge and does not edit history.</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Learner</label>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input value={learner ? `${learner.fullName} (${learner.studentNumber})` : query} onChange={(e) => search(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border rounded-xl dark:bg-gray-800 dark:border-gray-700 dark:text-white" placeholder="Search by name or student number" />
          </div>
          {!learner && results.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
              {results.slice(0, 8).map((item) => (
                <button type="button" key={item.id} onClick={() => { setLearner(item); setResults([]); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white">
                  {item.fullName} <span className="text-sm text-gray-500">({item.studentNumber})</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Service
            <select value={service} onChange={(e) => setService(e.target.value)} className="mt-1 w-full p-2.5 border rounded-xl dark:bg-gray-800 dark:border-gray-700">
              {SERVICES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Billing period
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 w-full p-2.5 border rounded-xl dark:bg-gray-800 dark:border-gray-700" />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Amount (R)
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full p-2.5 border rounded-xl dark:bg-gray-800 dark:border-gray-700" />
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={4}
            className="mt-1 w-full p-3 border rounded-xl dark:bg-gray-800 dark:border-gray-700" placeholder="Explain why this charge should have been billed (minimum 10 characters)." />
        </label>
        <button disabled={busy} className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold rounded-xl">
          {busy ? 'Creating charge…' : 'Review and create charge'}
        </button>
      </form>
    </div>
  );
};

export default MissingChargeReconciliation;