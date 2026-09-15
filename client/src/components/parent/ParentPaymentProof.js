import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, CheckCircle, Clock, XCircle, AlertCircle,
  ChevronLeft, Receipt, CreditCard, Banknote, Smartphone, Building2, Check
} from 'lucide-react';
import { parentApi, refreshParentAccess } from './ParentPortal';
import { getSafeParentDestination, parentLoginPath } from './parentNavigation';

const METHODS = [
  { value: 'eft', label: 'EFT / Bank Transfer', icon: Building2 },
  { value: 'atm', label: 'ATM Deposit', icon: Banknote },
  { value: 'cash', label: 'Cash Payment', icon: Banknote },
  { value: 'online', label: 'Online / SnapScan', icon: Smartphone },
];

const STATUS_STYLE = {
  pending:  { color: 'bg-amber-100 text-amber-700', icon: Clock,         label: 'Pending Review' },
  approved: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle, label: 'Approved' },
  rejected: { color: 'bg-red-100 text-red-700', icon: XCircle,          label: 'Rejected' },
};

const R = (n) => `R ${Number(n || 0).toFixed(2)}`;
const isDateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const calendarDate = (value) => {
  if (!value) return null;
  if (isDateOnly(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const fmt = (value) => {
  const date = calendarDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-ZA', isDateOnly(value)
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const requestMessage = (label, error) => {
  if (error?.status === 401) return `${label} could not be loaded because your parent session has expired. Please sign in again.`;
  if (error?.status === 403) return `${label} could not be loaded because this parent account is not permitted to view it.`;
  if (error?.status >= 500) return `${label} is temporarily unavailable. Please try again.`;
  return error?.message || `Could not load ${label.toLowerCase()}. Please try again.`;
};
const canRetry = (error) => !error?.status || error.status >= 500;

export default function ParentPaymentProof({ child, embedded = false }) {
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [submissions, setSubmissions] = useState([]);
  const [submissionStatus, setSubmissionStatus] = useState('loading');
  const [submissionError, setSubmissionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [method, setMethod] = useState('eft');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [oneOffFees, setOneOffFees] = useState([]);
  const [selectedFees, setSelectedFees] = useState([]);
  const [payableServices, setPayableServices] = useState([]);
  const applicableServices = payableServices;
  const [selectedServices, setSelectedServices] = useState([]);
  const [banking, setBanking] = useState(null);
  const [payableStatus, setPayableStatus] = useState('loading');
  const [payableError, setPayableError] = useState(null);
  const [bankingStatus, setBankingStatus] = useState('loading');
  const [bankingError, setBankingError] = useState(null);

  const fileRef = useRef();
  const submissionKeyRef = useRef(null);
  const receiptDialogRef = useRef(null);
  const receiptCloseRef = useRef(null);
  const receiptTriggerRef = useRef(null);
  const [receiptModal, setReceiptModal] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptPreviewFailed, setReceiptPreviewFailed] = useState(false);

  const viewReceipt = async (id, fileName) => {
    receiptTriggerRef.current = document.activeElement;
    setReceiptLoading(id);
    try {
      const token = sessionStorage.getItem('parentToken');
      const res = await fetch(`/api/payment-proofs/${id}/receipt`, {
        credentials: 'include',
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
      setError(`Could not open receipt: ${err.message}`);
    } finally {
      setReceiptLoading(null);
    }
  };

  const closeReceiptModal = () => {
    setReceiptModal(null);
    setReceiptPreviewFailed(false);
    requestAnimationFrame(() => receiptTriggerRef.current?.focus?.());
  };

  const handleReceiptDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReceiptModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = receiptDialogRef.current?.querySelectorAll(
      'button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
    );
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const url = receiptModal?.url;
    if (url) requestAnimationFrame(() => receiptCloseRef.current?.focus());
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [receiptModal?.url]);

  const authFetch = async (url) => {
    let token = sessionStorage.getItem('parentToken');
    let response = await fetch(url, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      try {
        token = await refreshParentAccess();
        response = await fetch(url, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (_) {
        const destination = getSafeParentDestination(`${window.location.pathname}${window.location.search}`);
        const sessionError = new Error('Parent session expired');
        sessionError.status = 401;
        sessionError.code = 'SESSION_EXPIRED';
        window.location.href = parentLoginPath(destination);
        throw sessionError;
      }
    }
    if (response.status === 401) {
      const destination = getSafeParentDestination(`${window.location.pathname}${window.location.search}`);
      const sessionError = new Error('Parent session expired');
      sessionError.status = 401;
      sessionError.code = 'SESSION_EXPIRED';
      window.location.href = parentLoginPath(destination);
      throw sessionError;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(data.message || 'Request failed');
      requestError.status = response.status;
      throw requestError;
    }
    return data;
  };

  const loadSubmissions = async () => {
    setSubmissionStatus('loading');
    setSubmissionError(null);
    const suffix = child?.id ? `?child_id=${child.id}` : '';
    try {
      const data = await authFetch(`/api/payment-proofs/my${suffix}`);
      if (!Array.isArray(data.submissions)) {
        throw new Error('The submissions response was invalid');
      }
      setSubmissions(data.submissions);
      setSubmissionStatus('ready');
    } catch (requestError) {
      setSubmissions([]);
      setSubmissionError(requestError);
      setSubmissionStatus('error');
    }
  };

  const loadPayables = async () => {
    setPayableStatus('loading');
    setPayableError(null);
    setPayableServices([]);
    setOneOffFees([]);
    try {
      const d = await parentApi('/payable-obligations');
      if (!Array.isArray(d?.obligations)) throw new Error('The payable obligations response was invalid');
      const obligations = d.obligations;
      setPayableServices(obligations.filter((item) => item.obligation_type === 'recurring' || item.category !== 'one_off'));
      setOneOffFees(obligations
        .filter((item) => item.category === 'one_off')
        .map((item) => ({
          ...item,
          id: item.one_off_fee_id || item.fee_id || item.obligation_id,
          name: item.label,
          remaining_amount: item.amount_outstanding,
          ledger_invoice_id: item.invoice_id,
          invoice_line_item_id: item.invoice_line_item_id,
          assignment_id: item.assignment_id,
          is_payable: item.is_payable,
          payment_status: item.status,
        })));
      setPayableStatus('ready');
    } catch (requestError) {
      setPayableServices([]);
      setOneOffFees([]);
      setPayableError(requestError);
      setPayableStatus('error');
    }
  };

  const loadBanking = async () => {
    setBankingStatus('loading');
    setBankingError(null);
    setBanking(null);
    try {
      const data = await parentApi('/banking-details');
      if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'banking')) {
        throw new Error('The banking details response was invalid');
      }
      setBanking(data.banking && typeof data.banking === 'object' ? data.banking : {});
      setBankingStatus('ready');
    } catch (requestError) {
      setBankingError(requestError);
      setBankingStatus('error');
    }
  };

  useEffect(() => {
    loadSubmissions();
    // All payment choices come from the canonical persisted-obligation
    // projection. The old fee and invoice endpoints each had subtly different
    // filtering rules (notably for archived one-offs and legacy Tuition).
    loadPayables();
    loadBanking();
  }, [child?.id]);

  // Recalculate total from both selected services and one-off fees
  const recalcTotal = (services, fees) => {
    const serviceTotal = services.reduce((s, p) => s + parseFloat(p.amount), 0);
    const feeTotal = fees.reduce((s, f) => s + parseFloat(f.remaining_amount ?? f.amount), 0);
    const total = serviceTotal + feeTotal;
    setAmount(total > 0 ? total.toFixed(2) : '');
  };

  const toggleService = (price) => {
    setSelectedServices(prev => {
      const exists = prev.find(p => p.obligation_id === price.obligation_id);
      const updated = exists
        ? prev.filter(p => p.obligation_id !== price.obligation_id)
        : [...prev, price];
      recalcTotal(updated, selectedFees);
      return updated;
    });
  };

  const toggleFee = (fee) => {
    setSelectedFees(prev => {
      const exists = prev.find(f => f.obligation_id === fee.obligation_id);
      const updated = exists ? prev.filter(f => f.obligation_id !== fee.obligation_id) : [...prev, fee];
      recalcTotal(selectedServices, updated);
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      if (!submissionKeyRef.current) {
        submissionKeyRef.current = globalThis.crypto?.randomUUID?.().replace(/-/g, '') ||
          `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
      const fd = new FormData();
      fd.append('amount', amount);
      fd.append('payment_method', method);
      fd.append('reference', reference);
      fd.append('notes', notes);
      fd.append('obligations', JSON.stringify([
        ...selectedServices.map((service) => ({
          obligation_id: service.obligation_id,
          invoice_id: service.invoice_id,
          invoice_line_item_id: service.invoice_line_item_id,
          service_key: service.service_key,
          category: service.service_key,
          amount: Number(service.amount_outstanding ?? service.amount),
          legacy_invoice_level: service.obligation_type === 'legacy_invoice',
        })),
        ...selectedFees.map((fee) => ({
          obligation_id: fee.obligation_id,
          fee_id: fee.id,
          assignment_id: fee.assignment_id,
          invoice_id: fee.ledger_invoice_id,
          invoice_line_item_id: fee.invoice_line_item_id,
          category: 'one_off',
          amount: Number(fee.amount_outstanding ?? fee.remaining_amount ?? fee.amount),
          legacy_invoice_level: fee.obligation_type === 'legacy_invoice',
        })),
      ]));
      if (child?.id) fd.append('child_id', child.id);
      if (file) fd.append('receipt', file);

      const token = sessionStorage.getItem('parentToken');
      const res = await fetch('/api/payment-proofs', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': submissionKeyRef.current,
        },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Submission failed');

      setSuccess('Your proof of payment has been submitted! The admin will review it shortly.');
      submissionKeyRef.current = null;
      setAmount(''); setReference(''); setNotes(''); setFile(null);
      setSelectedFees([]); setSelectedServices([]);
      setView('list');
      loadSubmissions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Proof of Payment</h1>
            {child && (
              <p className="text-gray-500 text-sm mt-1">{child.first_name} {child.last_name} &bull; {child.student_number}</p>
            )}
          </div>
          {view === 'list' ? (
            <button
              onClick={() => { setView('form'); setSuccess(null); setError(null); }}
              className="parent-payment-primary flex items-center gap-2 text-white text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform"
            >
              <Upload className="h-4 w-4" /> Submit Proof
            </button>
          ) : (
            <button
              onClick={() => setView('list')}
              className="flex items-center gap-2 text-gray-500 text-sm font-medium"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          )}
        </div>
      )}

      {embedded && view === 'list' && (
        <button
          onClick={() => { setView('form'); setSuccess(null); setError(null); }}
          className="parent-payment-primary w-full flex items-center justify-center gap-2 text-white text-sm font-semibold px-4 py-3 rounded-2xl active:scale-95 transition-transform"
        >
          <Upload className="h-4 w-4" /> Submit New Proof of Payment
        </button>
      )}
      {embedded && view === 'form' && (
        <button
          onClick={() => setView('list')}
          className="flex items-center gap-2 text-gray-500 text-sm font-medium"
        >
          <ChevronLeft className="h-4 w-4" /> Back to submissions
        </button>
      )}

      {success && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-sm">
          <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
          {success}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ── Submit Form ── */}
      {view === 'form' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {payableStatus === 'loading' && (
            <div className="rounded-xl border border-gray-100 bg-white p-3 text-sm text-gray-500">
              Loading payable obligations…
            </div>
          )}
          {payableStatus === 'error' && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="flex-1">{requestMessage('Payable obligations', payableError)}</span>
              {canRetry(payableError) && (
                <button type="button" onClick={loadPayables} className="shrink-0 font-semibold underline">
                  Retry
                </button>
              )}
            </div>
          )}
          {payableStatus === 'ready' && payableServices.length === 0 && oneOffFees.length === 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-3 text-sm text-gray-500">
              There are no payable obligations currently available for this child. You may still enter the amount paid below.
            </div>
          )}
          {/* Payment Method */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Payment Method</p>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(m => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`flex items-center gap-2 border-2 rounded-xl p-3 text-sm font-medium transition-colors ${
                      method === m.value
                        ? 'border-[#2c7475] bg-[#e8f1ef] text-[#176b73]'
                        : 'border-gray-100 text-gray-600 bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Monthly service rates */}
          {applicableServices.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-700">Monthly Service Rates</p>
                <p className="text-xs text-gray-400 mt-0.5">Tick the services you are paying for this month</p>
              </div>
              <div className="space-y-2">
                {applicableServices.map(price => {
                  const checked = selectedServices.some(s => s.obligation_id === price.obligation_id);
                  return (
                    <label key={price.obligation_id} className={`parent-fee-choice ${checked ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                         disabled={!price.is_payable}
                        onChange={() => toggleService(price)}
                        className="parent-fee-choice-input"
                      />
                      <span className="parent-fee-choice-box" aria-hidden="true">{checked && <Check />}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700">
                          {price.label} {price.billing_period_label ? `— ${price.billing_period_label}` : ''}
                        </p>
                        {price.description && <p className="text-xs text-gray-400">{price.description}</p>}
                        {!price.is_payable && (
                          <p className="text-xs text-amber-700">
                            {price.status === 'PENDING_REVIEW'
                              ? 'Pending admin review'
                              : 'Requires reconciliation before payment'}
                          </p>
                        )}
                      </div>
                        <span className="text-sm font-bold text-[#176b73] shrink-0">
                          {R(price.amount_outstanding ?? price.amount)}<span className="text-gray-400 font-normal text-xs"> outstanding</span>
                        </span>
                    </label>
                  );
                })}
              </div>
              {selectedServices.length > 0 && (
                <div className="bg-[#e8f1ef] rounded-xl px-3 py-2 text-xs text-[#176b73] font-medium">
                  Services subtotal: {R(selectedServices.reduce((s, p) => s + parseFloat(p.amount), 0))}
                </div>
              )}
            </div>
          )}

          {/* One-off fees (optional) */}
          {oneOffFees.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Optional Fees to Include</p>
              <p className="text-xs text-gray-400">Check any fees you are paying with this payment</p>
              <div className="space-y-2">
                {oneOffFees.map(fee => (
                  <label key={fee.obligation_id} className={`parent-fee-choice ${selectedFees.some(f => f.obligation_id === fee.obligation_id) ? 'is-selected' : ''} ${!fee.is_payable ? 'opacity-70' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedFees.some(f => f.obligation_id === fee.obligation_id)}
                      onChange={() => toggleFee(fee)}
                      disabled={!fee.is_payable}
                       className="parent-fee-choice-input"
                    />
                      <span className="parent-fee-choice-box" aria-hidden="true">{selectedFees.some(f => f.obligation_id === fee.obligation_id) && <Check />}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{fee.name}</p>
                        {fee.due_date_label && <p className="text-xs text-gray-400">{fee.due_date_label}</p>}
                      {fee.description && <p className="parent-fee-choice-description text-xs text-gray-500">{fee.description}</p>}
                    </div>
                      <span className="text-right text-sm font-semibold text-[#176b73] shrink-0">
                         {R(fee.amount_outstanding ?? fee.remaining_amount ?? fee.amount)}
                         {fee.payment_status && fee.payment_status !== 'UNPAID' && (
                          <span className="block text-[10px] text-gray-500">
                             {fee.payment_status === 'REQUIRES_RECONCILIATION'
                               ? 'Requires Admin reconciliation'
                              : fee.payment_status.replaceAll('_', ' ')}
                          </span>
                        )}
                      </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Amount */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
            <label className="text-sm font-semibold text-gray-700">Amount Paid (R)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
               className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-[#2c7475]/30"
            />
          </div>

          {/* Reference */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
            <label className="text-sm font-semibold text-gray-700">Reference / Proof Number <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="e.g. EFT Ref 12345"
               className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2c7475]/30"
            />
          </div>

          {/* Upload receipt */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
            <p className="text-sm font-semibold text-gray-700">Upload Receipt <span className="text-gray-400 font-normal">(optional)</span></p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={e => setFile(e.target.files[0] || null)}
              className="hidden"
            />
            {file ? (
               <div className="flex items-center gap-3 bg-[#e8f1ef] border border-[#c7dedd] rounded-xl px-3 py-2.5">
                 <Receipt className="h-4 w-4 text-[#176b73] shrink-0" />
                 <p className="text-sm text-[#176b73] font-medium truncate flex-1">{file.name}</p>
                 <button type="button" onClick={() => setFile(null)} className="text-[#617487] hover:text-red-500">
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                 className="w-full flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-6 text-gray-400 hover:border-[#7fa9a7] hover:text-[#176b73] transition-colors"
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm">Tap to upload photo or PDF</span>
              </button>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
            <label className="text-sm font-semibold text-gray-700">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Any additional information for the admin..."
               className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2c7475]/30 resize-none"
            />
          </div>

          {/* Banking Details reminder */}
           <div className="bg-[#f6f8f6] border border-[#dce6ea] rounded-2xl p-4">
             <p className="text-[#19324a] font-semibold text-sm mb-2">Banking Details</p>
              {bankingStatus === 'loading' ? (
                <p className="text-xs text-[#617487]">Loading banking details…</p>
              ) : bankingStatus === 'error' ? (
                <div className="flex items-start gap-2 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{requestMessage('Banking details', bankingError)}</span>
                  {canRetry(bankingError) && (
                    <button type="button" onClick={loadBanking} className="font-semibold underline shrink-0">
                      Retry
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-0.5 text-xs text-[#617487]">
                  <p><span className="font-medium">Bank:</span> {banking?.bank || 'Not provided'}</p>
                  <p><span className="font-medium">Account:</span> {banking?.accountNumber || 'Not provided'} &bull; Branch: {banking?.branchCode || 'Not provided'}</p>
                  <p className="mt-1 text-[#176b73] font-semibold">Reference: {child?.student_number || 'your child\'s student number'}</p>
                </div>
              )}
          </div>

          <button
            type="submit"
            disabled={submitting}
             className="parent-payment-primary w-full text-white font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-transform disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit Proof of Payment'}
          </button>
        </form>
      )}

      {/* ── Submission History ── */}
      {view === 'list' && (
        <>
          {submissionStatus === 'loading' ? (
            <div className="flex justify-center py-10">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2c7475]" />
            </div>
          ) : submissionStatus === 'error' ? (
            <div className="bg-red-50 rounded-2xl border border-red-200 p-8 text-center">
              <AlertCircle className="h-10 w-10 text-red-300 mx-auto mb-3" />
              <p className="text-red-700 text-sm">{requestMessage('Payment submissions', submissionError)}</p>
              {canRetry(submissionError) && (
                <button type="button" onClick={loadSubmissions} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white">
                  Retry
                </button>
              )}
            </div>
          ) : submissions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <Receipt className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No submissions yet</p>
              <p className="text-gray-300 text-xs mt-1">Submit proof of your payment and we'll verify it within 24 hours</p>
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map(sub => {
                const st = STATUS_STYLE[sub.status] || STATUS_STYLE.pending;
                const Icon = st.icon;
                return (
                  <div key={sub.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold text-gray-800">{R(sub.amount)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {METHODS.find(m => m.value === sub.payment_method)?.label || sub.payment_method}
                          {sub.reference && <span> &bull; {sub.reference}</span>}
                        </p>
                        <p className="text-xs text-gray-400">{fmt(sub.submitted_at)}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${st.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {st.label}
                      </span>
                    </div>
                    {sub.admin_note && (
                      <div className={`mt-3 text-xs rounded-lg p-2.5 ${sub.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
                        <span className="font-semibold">Admin note:</span> {sub.admin_note}
                      </div>
                    )}
                    {sub.receipt_file_name && (
                      <button
                        onClick={() => viewReceipt(sub.id, sub.receipt_file_name)}
                        disabled={receiptLoading === sub.id}
                         className="mt-3 flex items-center gap-1.5 text-xs text-[#176b73] font-medium disabled:opacity-50"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        {receiptLoading === sub.id ? 'Opening…' : 'View receipt'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Receipt Viewer Modal */}
      {receiptModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={closeReceiptModal}>
          <div
            ref={receiptDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="parent-receipt-dialog-title"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            onKeyDown={handleReceiptDialogKeyDown}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p id="parent-receipt-dialog-title" className="min-w-0 break-all text-sm font-semibold text-gray-700">{receiptModal.fileName}</p>
              <button ref={receiptCloseRef} type="button" aria-label="Close receipt preview" onClick={closeReceiptModal} className="text-gray-400 hover:text-gray-700 text-2xl leading-none ml-3">&times;</button>
            </div>
            <div className="flex-1 overflow-auto flex-col flex items-center justify-center bg-gray-50 p-2 min-h-[280px]">
              {receiptModal.mime === 'application/pdf' && !receiptPreviewFailed ? (
                <iframe
                  src={receiptModal.url}
                  title="Receipt"
                  className="w-full min-h-[400px] rounded"
                  onError={() => setReceiptPreviewFailed(true)}
                />
              ) : receiptModal.mime !== 'application/pdf' ? (
                <img
                  src={receiptModal.url}
                  alt="Receipt"
                  className="max-w-full max-h-[65vh] object-contain rounded"
                  onError={() => setReceiptPreviewFailed(true)}
                />
              ) : null}
              {receiptPreviewFailed && (
                <p className="text-sm text-gray-600 text-center px-5 py-8">
                  This browser could not display the receipt inline. Use Open or Download below.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
              <a href={receiptModal.url} target="_blank" rel="noreferrer" className="px-3 py-2 text-sm font-medium text-[#176b73]">Open</a>
              <a href={receiptModal.url} download={receiptModal.fileName} className="px-3 py-2 rounded-lg bg-[#176b73] text-white text-sm font-medium">Download</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
