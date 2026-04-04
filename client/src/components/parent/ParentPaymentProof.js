import React, { useState, useEffect, useRef } from 'react';
import { parentApi } from './ParentPortal';
import {
  Upload, CheckCircle, Clock, XCircle, AlertCircle,
  ChevronLeft, Receipt, CreditCard, Banknote, Smartphone, Building2
} from 'lucide-react';

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
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export default function ParentPaymentProof({ child }) {
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [servicePrices, setServicePrices] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);

  const fileRef = useRef();

  // Which service keys apply to this child
  const applicableServiceKeys = ['tuition'].concat([
    child?.is_boarder    ? 'boarding'  : null,
    child?.uses_transport ? 'transport' : null,
    child?.uses_aftercare ? 'aftercare' : null,
  ].filter(Boolean));

  const applicableServices = servicePrices.filter(
    p => applicableServiceKeys.includes(p.service_key) && parseFloat(p.amount) > 0
  );

  const loadSubmissions = () => {
    setLoading(true);
    setError(null);
    const suffix = child?.id ? `?child_id=${child.id}` : '';
    parentApi(`/payment-proofs/my${suffix}`)
      .then(d => setSubmissions(d.submissions || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSubmissions();
    const suffix = child?.id ? `?child_id=${child.id}` : '';
    parentApi(`/student-fees/for-child${suffix}`)
      .then(d => setOneOffFees(d.fees || []))
      .catch(() => {});
    // Load service prices
    const token = localStorage.getItem('parentToken');
    fetch('/api/service-prices', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setServicePrices(d.prices || []))
      .catch(() => {});
  }, [child?.id]);

  // Recalculate total from both selected services and one-off fees
  const recalcTotal = (services, fees) => {
    const serviceTotal = services.reduce((s, p) => s + parseFloat(p.amount), 0);
    const feeTotal = fees.reduce((s, f) => s + parseFloat(f.amount), 0);
    const total = serviceTotal + feeTotal;
    if (total > 0) setAmount(total.toFixed(2));
  };

  const toggleService = (price) => {
    setSelectedServices(prev => {
      const exists = prev.find(p => p.service_key === price.service_key);
      const updated = exists
        ? prev.filter(p => p.service_key !== price.service_key)
        : [...prev, price];
      recalcTotal(updated, selectedFees);
      return updated;
    });
  };

  const toggleFee = (fee) => {
    setSelectedFees(prev => {
      const exists = prev.find(f => f.id === fee.id);
      const updated = exists ? prev.filter(f => f.id !== fee.id) : [...prev, fee];
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
      const fd = new FormData();
      fd.append('amount', amount);
      fd.append('payment_method', method);
      fd.append('reference', reference);
      fd.append('notes', notes);
      if (child?.id) fd.append('child_id', child.id);
      if (file) fd.append('receipt', file);

      const token = localStorage.getItem('parentToken');
      const res = await fetch('/api/payment-proofs', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Submission failed');

      setSuccess('Your proof of payment has been submitted! The admin will review it shortly.');
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
            className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform"
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
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
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
                  const checked = selectedServices.some(s => s.service_key === price.service_key);
                  return (
                    <label key={price.service_key} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleService(price)}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700">{price.label}</p>
                        {price.description && <p className="text-xs text-gray-400">{price.description}</p>}
                      </div>
                      <span className="text-sm font-bold text-blue-600 shrink-0">{R(price.amount)}<span className="text-gray-400 font-normal text-xs">/mo</span></span>
                    </label>
                  );
                })}
              </div>
              {selectedServices.length > 0 && (
                <div className="bg-blue-50 rounded-xl px-3 py-2 text-xs text-blue-700 font-medium">
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
                  <label key={fee.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedFees.some(f => f.id === fee.id)}
                      onChange={() => toggleFee(fee)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{fee.name}</p>
                      {fee.description && <p className="text-xs text-gray-400 truncate">{fee.description}</p>}
                    </div>
                    <span className="text-sm font-semibold text-blue-600 shrink-0">{R(fee.amount)}</span>
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
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300"
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
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Upload receipt */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
            <p className="text-sm font-semibold text-gray-700">Upload Receipt <span className="text-gray-400 font-normal">(optional)</span></p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={e => setFile(e.target.files[0] || null)}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
                <Receipt className="h-4 w-4 text-blue-600 shrink-0" />
                <p className="text-sm text-blue-700 font-medium truncate flex-1">{file.name}</p>
                <button type="button" onClick={() => setFile(null)} className="text-blue-400 hover:text-red-500">
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-6 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
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
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />
          </div>

          {/* Banking Details reminder */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
            <p className="text-blue-800 font-semibold text-sm mb-2">Banking Details</p>
            <div className="space-y-0.5 text-xs text-blue-700">
              <p><span className="font-medium">Bank:</span> First National Bank (FNB)</p>
              <p><span className="font-medium">Account:</span> 63053202265 &bull; Branch: 210755</p>
              <p className="mt-1 text-blue-600 font-semibold">Reference: {child?.student_number || 'your child\'s student number'}</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl text-sm active:scale-95 transition-transform disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit Proof of Payment'}
          </button>
        </form>
      )}

      {/* ── Submission History ── */}
      {view === 'list' && (
        <>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
                      <a
                        href={`/api/payment-proofs/${sub.id}/receipt`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 font-medium"
                      >
                        <Receipt className="h-3.5 w-3.5" /> View receipt
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
