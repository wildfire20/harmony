import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock, Search, Eye, AlertCircle, RefreshCw, Receipt } from 'lucide-react';

const API_BASE = '/api';
const authHeaders = () => {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
};

const R = (n) => `R ${Number(n || 0).toFixed(2)}`;
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (d) => d ? new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const optionKey = (item) => [
  item.invoice_id || '',
  item.invoice_line_item_id || '',
  item.fee_id || '',
  item.category || item.service_key || '',
].join(':');

const STATUS_STYLE = {
  pending:  { color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  approved: { color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
  rejected: { color: 'bg-red-100 text-red-700 border-red-200', icon: XCircle },
};

const METHOD_LABELS = {
  eft: 'EFT / Bank Transfer',
  atm: 'ATM Deposit',
  cash: 'Cash',
  online: 'Online / SnapScan',
  proof_of_payment: 'Proof of Payment',
};

export default function PendingPayments() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptModal, setReceiptModal] = useState(null);
  const [receiptPreviewFailed, setReceiptPreviewFailed] = useState(false);
  const [allocationDraft, setAllocationDraft] = useState([]);
  const [allocationReason, setAllocationReason] = useState('');
  const [allocationOptions, setAllocationOptions] = useState([]);

  const viewReceipt = async (id, fileName) => {
    setReceiptLoading(true);
    setFeedback(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/payment-proofs/${id}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Could not load receipt');
      }
      const blob = await res.blob();
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
        throw new Error('Unsupported receipt format');
      }
      const url = URL.createObjectURL(blob);
      setReceiptPreviewFailed(false);
      setReceiptModal({ url, mime: blob.type, fileName: fileName || 'Receipt' });
    } catch (err) {
      setFeedback({ type: 'error', message: `Could not open receipt: ${err.message}` });
    } finally {
      setReceiptLoading(false);
    }
  };

  const closeReceiptModal = () => {
    setReceiptModal(null);
    setReceiptPreviewFailed(false);
  };

  useEffect(() => {
    const url = receiptModal?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [receiptModal?.url]);

  useEffect(() => {
    setAllocationDraft(Array.isArray(selected?.selected_obligations)
      ? selected.selected_obligations.map((item) => ({ ...item })) : []);
    setAllocationReason('');
    if (selected?.status === 'pending') {
      fetch(`${API_BASE}/payment-proofs/${selected.id}/allocation-options`, { headers: authHeaders() })
        .then((response) => response.json())
        .then((data) => setAllocationOptions(data.options || []))
        .catch(() => setAllocationOptions([]));
    } else {
      setAllocationOptions([]);
    }
  }, [selected]);

  const saveAllocationAdjustment = async () => {
    if (!allocationReason.trim()) {
      setFeedback({ type: 'error', message: 'Enter a reason for the allocation adjustment' });
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/payment-proofs/${selected.id}/allocations`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ obligations: allocationDraft, reason: allocationReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not update allocation');
      setSelected((current) => ({ ...current, selected_obligations: data.obligations }));
      setFeedback({ type: 'success', message: data.message });
      setAllocationReason('');
    } catch (error) {
      setFeedback({ type: 'error', message: error.message });
    } finally {
      setActionLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: filter, search });
      const res = await fetch(`${API_BASE}/payment-proofs?${params}`, { headers: authHeaders() });
      const data = await res.json();
      setSubmissions(data.submissions || []);
    } catch {
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action) => {
    if (!selected) return;
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/payment-proofs/${selected.id}/${action}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ admin_note: adminNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setFeedback({ type: 'success', message: action === 'approve' ? `Payment of ${R(selected.amount)} approved and applied to student balance.` : 'Submission rejected.' });
      setSelected(null);
      setAdminNote('');
      load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete this submission from ${selected.student_first_name} ${selected.student_last_name}? This cannot be undone.`)) return;
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/payment-proofs/${selected.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSelected(null);
      setAdminNote('');
      load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const pendingCount = submissions.filter(s => s.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Pending Payments
            {filter === 'pending' && pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingCount}</span>
            )}
          </h2>
          <p className="text-gray-400 text-sm mt-0.5">Review and approve parent proof of payment submissions</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <RefreshCw className="h-4 w-4" /> Refresh
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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex rounded-xl overflow-hidden border border-gray-200 self-start">
          {['pending', 'approved', 'rejected', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-2 text-xs font-semibold capitalize transition-colors ${
                filter === s ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search student or parent name…"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Receipt className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No submissions found</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="hidden sm:grid grid-cols-6 text-xs font-semibold text-gray-400 uppercase px-5 py-3 border-b border-gray-50 bg-gray-50">
            <span className="col-span-2">Student / Parent</span>
            <span>Method</span>
            <span>Amount</span>
            <span>Submitted</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-gray-50">
            {submissions.map(sub => {
              const st = STATUS_STYLE[sub.status] || STATUS_STYLE.pending;
              const Icon = st.icon;
              return (
                <div
                  key={sub.id}
                  className="grid sm:grid-cols-6 items-center gap-2 px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => { setSelected(sub); setAdminNote(''); setFeedback(null); }}
                >
                  <div className="sm:col-span-2">
                    <p className="text-sm font-semibold text-gray-800">{sub.student_first_name} {sub.student_last_name}</p>
                    <p className="text-xs text-gray-400">{sub.student_number}</p>
                    <p className="text-xs text-gray-400">Parent: {sub.parent_first_name} {sub.parent_last_name}</p>
                  </div>
                  <p className="text-sm text-gray-600">{METHOD_LABELS[sub.payment_method] || sub.payment_method}</p>
                  <p className="text-sm font-bold text-gray-800">{R(sub.amount)}</p>
                  <p className="text-xs text-gray-400">{fmtTime(sub.submitted_at)}</p>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border w-fit ${st.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {sub.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Receipt Viewer Modal */}
      {receiptModal && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={closeReceiptModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700 truncate">{receiptModal.fileName}</p>
              <button onClick={closeReceiptModal} className="text-gray-400 hover:text-gray-700 text-2xl leading-none ml-4">&times;</button>
            </div>
            <div className="flex-1 overflow-auto flex-col flex items-center justify-center bg-gray-50 p-2 min-h-[300px]">
              {receiptModal.mime === 'application/pdf' && !receiptPreviewFailed ? (
                <iframe
                  src={receiptModal.url}
                  title="Receipt"
                  className="w-full h-full min-h-[500px] rounded"
                  onError={() => setReceiptPreviewFailed(true)}
                />
              ) : receiptModal.mime !== 'application/pdf' ? (
                <img
                  src={receiptModal.url}
                  alt="Receipt"
                  className="max-w-full max-h-[70vh] object-contain rounded"
                  onError={() => setReceiptPreviewFailed(true)}
                />
              ) : null}
              {receiptPreviewFailed && (
                <p className="text-sm text-gray-600 text-center px-5 py-8">
                  This browser could not display the receipt inline. Use Open or Download below.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
              <a href={receiptModal.url} target="_blank" rel="noreferrer" className="px-3 py-2 text-sm font-medium text-teal-700">Open</a>
              <a href={receiptModal.url} download={receiptModal.fileName} className="px-3 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium">Download</a>
            </div>
          </div>
        </div>
      )}

      {/* Detail / Action Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <p className="text-lg font-bold text-gray-900">Payment Submission</p>
              <p className="text-sm text-gray-400 mt-0.5">#{selected.id} &bull; {fmtTime(selected.submitted_at)}</p>
            </div>
            <div className="p-5 space-y-4">
              {/* Student info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Student</p>
                  <p className="text-sm font-semibold text-gray-800">{selected.student_first_name} {selected.student_last_name}</p>
                  <p className="text-xs text-gray-400">{selected.student_number}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Parent</p>
                  <p className="text-sm font-semibold text-gray-800">{selected.parent_first_name} {selected.parent_last_name}</p>
                  <p className="text-xs text-gray-400">{selected.phone_number}</p>
                </div>
              </div>

              {/* Payment details */}
              <div className="bg-blue-50 rounded-xl p-4 space-y-1.5">
                <div className="flex justify-between"><span className="text-sm text-gray-500">Amount</span><span className="text-lg font-bold text-blue-700">{R(selected.amount)}</span></div>
                <div className="flex justify-between"><span className="text-sm text-gray-500">Method</span><span className="text-sm text-gray-700">{METHOD_LABELS[selected.payment_method] || selected.payment_method}</span></div>
                {selected.reference && <div className="flex justify-between"><span className="text-sm text-gray-500">Reference</span><span className="text-sm text-gray-700">{selected.reference}</span></div>}
                {selected.notes && <div className="pt-1 text-sm text-gray-600 italic">"{selected.notes}"</div>}
              </div>
              {selected.status === 'pending' && allocationDraft.length > 0 && (
                <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 space-y-3">
                  <div className="flex justify-between text-sm font-semibold text-gray-700">
                    <span>Proposed allocations</span>
                    <span>{R(allocationDraft.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</span>
                  </div>
                  {allocationDraft.map((item, index) => (
                    <div key={`${item.category || item.service_key || item.fee_id}-${index}`} className="flex items-center gap-3">
                      <select
                        value={optionKey(item)}
                        onChange={(event) => {
                          const option = allocationOptions.find((candidate) => optionKey(candidate) === event.target.value);
                          if (option) setAllocationDraft((current) => current.map((row, rowIndex) =>
                            rowIndex === index ? {
                              invoice_id: option.invoice_id,
                              invoice_line_item_id: option.invoice_line_item_id,
                              fee_id: option.fee_id || undefined,
                              assignment_id: option.assignment_id || undefined,
                              category: option.category,
                              amount: option.amount,
                            } : row));
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                      >
                        {!allocationOptions.some((option) => optionKey(option) === optionKey(item)) && (
                          <option value={optionKey(item)} disabled>
                            {item.category || item.service_key || `Fee ${item.fee_id}`} — unavailable, retarget or remove
                          </option>
                        )}
                        {allocationOptions.map((option) => (
                          <option key={optionKey(option)} value={optionKey(option)}>{option.label}</option>
                        ))}
                      </select>
                      <input
                        type="number" min="0.01" step="0.01"
                        value={item.amount || ''}
                        onChange={(event) => setAllocationDraft((current) => current.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, amount: Number(event.target.value) } : row))}
                        className="w-28 rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm"
                      />
                      <button type="button" onClick={() => setAllocationDraft((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        className="text-xs text-red-600">Remove</button>
                    </div>
                  ))}
                  {allocationOptions.length > 0 && (
                    <button type="button" onClick={() => {
                      const used = new Set(allocationDraft.map(optionKey));
                      const option = allocationOptions.find((candidate) => !used.has(optionKey(candidate)));
                      if (option) setAllocationDraft((current) => [...current, {
                        invoice_id: option.invoice_id,
                        invoice_line_item_id: option.invoice_line_item_id,
                        fee_id: option.fee_id || undefined,
                        assignment_id: option.assignment_id || undefined,
                        category: option.category,
                        amount: option.amount,
                      }]);
                    }} className="text-xs font-semibold text-teal-700">+ Add another obligation</button>
                  )}
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Unallocated / review</span>
                    <span>{R(Math.max(0, Number(selected.amount) - allocationDraft.reduce((sum, item) => sum + Number(item.amount || 0), 0)))}</span>
                  </div>
                  <textarea
                    value={allocationReason}
                    onChange={(event) => setAllocationReason(event.target.value)}
                    placeholder="Required reason for changing the proposed allocation"
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  {feedback?.type === 'error' && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{feedback.message}</span>
                    </div>
                  )}
                  <button type="button" onClick={saveAllocationAdjustment} disabled={actionLoading}
                    className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    Save allocation adjustment
                  </button>
                </div>
              )}

              {/* Receipt */}
              {selected.receipt_file_name && (
                <button
                  onClick={() => viewReceipt(selected.id, selected.receipt_file_name)}
                  disabled={receiptLoading}
                  className="w-full flex items-center gap-2 text-sm text-blue-600 font-medium bg-blue-50 border border-blue-100 rounded-xl p-3 hover:bg-blue-100 transition-colors disabled:opacity-60"
                >
                  <Eye className="h-4 w-4 shrink-0" />
                  {receiptLoading ? 'Opening…' : `View Receipt: ${selected.receipt_file_name}`}
                </button>
              )}

              {/* If already reviewed */}
              {selected.status !== 'pending' && (
                <div className={`rounded-xl p-3 text-sm ${selected.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  <p className="font-semibold capitalize">{selected.status} by {selected.reviewed_by_first_name} {selected.reviewed_by_last_name} on {fmt(selected.reviewed_at)}</p>
                  {selected.admin_note && <p className="mt-1 opacity-80">{selected.admin_note}</p>}
                </div>
              )}

              {/* Action area for pending */}
              {selected.status === 'pending' && (
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Admin Note (optional)</label>
                    <textarea
                      value={adminNote}
                      onChange={e => setAdminNote(e.target.value)}
                      rows={2}
                      placeholder="e.g. Payment matched, thank you"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleAction('reject')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 font-semibold py-2.5 rounded-xl text-sm hover:bg-red-50 disabled:opacity-60 transition-colors"
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </button>
                    <button
                      onClick={() => handleAction('approve')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      <CheckCircle className="h-4 w-4" /> Approve
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 text-center">Approving will automatically apply the payment to the student's outstanding balance.</p>
                </div>
              )}

              {selected.status !== 'approved' && <div className="pt-2 border-t border-gray-100 flex justify-center">
                <button
                  onClick={handleDelete}
                  disabled={actionLoading}
                  className="text-xs text-red-400 hover:text-red-600 underline disabled:opacity-50 transition-colors"
                >
                  Delete this submission
                </button>
              </div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
