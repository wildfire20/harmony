import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { CreditCard, AlertCircle, Upload, Bed, Bus, Sunset, FileText } from 'lucide-react';
import ParentPaymentProof from './ParentPaymentProof';

const STATUS_CONFIG = {
  Paid:             { label: 'Paid',             color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  Partial:          { label: 'Partial',          color: 'bg-amber-100 text-amber-700',    dot: 'bg-amber-500' },
  Unpaid:           { label: 'Unpaid',           color: 'bg-red-100 text-red-700',        dot: 'bg-red-500' },
  Overpaid:         { label: 'Overpaid',         color: 'bg-amber-100 text-amber-800',     dot: 'bg-amber-500' },
  'Carried Forward':{ label: 'Carried Forward',  color: 'bg-gray-100 text-gray-500',      dot: 'bg-gray-400' },
};

const R = (n) => `R ${Number(n || 0).toFixed(2)}`;

const ParentInvoices = ({ child }) => {
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [serviceComponents, setServiceComponents] = useState([]);
  const [totals, setTotals] = useState({ totalDue: 0, totalPaid: 0, outstanding: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banking, setBanking] = useState(null);

  useEffect(() => {
    setLoading(true);
    parentApi('/invoices')
      .then((d) => {
        setInvoices(d.invoices || []);
        setTotals(d.totals || {});
        setServiceComponents(d.serviceComponents || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    parentApi('/banking-details').then(d => setBanking(d.banking)).catch(() => {});
  }, [child?.id]);

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fees &amp; Payments</h1>
        {child && (
          <p className="text-gray-500 text-sm mt-1">
            {child.first_name} {child.last_name} &bull; {child.student_number}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab('invoices')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'invoices'
               ? 'bg-white shadow text-[#176b73]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="h-4 w-4" />
          Invoices
        </button>
        <button
          onClick={() => setTab('pay')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'pay'
               ? 'bg-white shadow text-[#176b73]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Upload className="h-4 w-4" />
          Submit Proof
        </button>
      </div>

      {/* ── INVOICES TAB ─────────────────────────────────────────────────────── */}
      {tab === 'invoices' && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
             <div className="bg-[#19324a] rounded-2xl p-4 text-white text-center">
               <p className="text-[#c9dddf] text-xs font-medium">Total Billed</p>
              <p className="text-lg font-bold mt-0.5">{R(totals.totalDue)}</p>
            </div>
            <div className="bg-emerald-500 rounded-2xl p-4 text-white text-center">
              <p className="text-emerald-100 text-xs font-medium">Total Paid</p>
              <p className="text-lg font-bold mt-0.5">{R(totals.totalPaid)}</p>
            </div>
            <div className={`${totals.outstanding > 0 ? 'bg-red-500' : 'bg-gray-400'} rounded-2xl p-4 text-white text-center`}>
              <p className="text-white/80 text-xs font-medium">Outstanding</p>
              <p className="text-lg font-bold mt-0.5">{R(totals.outstanding)}</p>
            </div>
          </div>

          {/* Enrolled services */}
          {serviceComponents.length > 0 && (
             <div className="bg-[#f6f8f6] border border-[#dce6ea] rounded-2xl p-4">
                <p className="text-[#19324a] font-semibold text-sm mb-1">Services &amp; Billing</p>
                <p className="text-[#617487] text-xs mb-2">Enrollment is separate from what is billed on an invoice.</p>
              <div className="grid grid-cols-2 gap-2">
                {serviceComponents.map((component) => (
                     <span key={component.key} className="flex items-center justify-between gap-2 bg-white text-[#617487] text-xs font-semibold px-2.5 py-1.5 rounded-lg">
                    <span className="flex items-center gap-1.5">
                      {component.key === 'boarding' && <Bed className="h-3.5 w-3.5" />}
                      {component.key === 'transport' && <Bus className="h-3.5 w-3.5" />}
                      {component.key === 'aftercare' && <Sunset className="h-3.5 w-3.5" />}
                      {component.label}
                    </span>
                      <span className="text-right">Enrollment only</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick action: switch to pay tab */}
          <button
            onClick={() => setTab('pay')}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold py-3 rounded-2xl text-sm active:scale-95 transition-transform"
          >
            <Upload className="h-4 w-4" />
            Submit Proof of Payment
          </button>

          {/* Banking details */}
           <div className="bg-[#f6f8f6] border border-[#dce6ea] rounded-2xl p-4">
             <p className="text-[#19324a] font-semibold text-sm mb-2">Banking Details</p>
             <div className="space-y-1 text-xs text-[#617487]">
               <p><span className="font-medium">Bank:</span> {banking?.bank || 'Loading…'}</p>
               <p><span className="font-medium">Account Holder:</span> {banking?.accountHolder || 'Loading…'}</p>
               <p><span className="font-medium">Account Number:</span> {banking?.accountNumber || 'Loading…'}</p>
               <p><span className="font-medium">Branch Code:</span> {banking?.branchCode || 'Loading…'}</p>
               <p><span className="font-medium">Account Type:</span> {banking?.accountType || 'Loading…'}</p>
               <p className="mt-2 text-[#176b73] font-semibold">
                Reference: Use your child's student number ({child?.student_number || '—'})
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2c7475]" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <CreditCard className="h-10 w-10 text-gray-200 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">No invoices on record</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-4 text-xs font-semibold text-gray-400 uppercase px-4 py-3 border-b border-gray-50">
                <span>Month</span>
                <span className="text-right">Due</span>
                <span className="text-right">Paid</span>
                <span className="text-right">Status</span>
              </div>
              <div className="divide-y divide-gray-50">
                {invoices.map((inv) => {
                  const cfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.Unpaid;
                  const dueDate = inv.due_date ? new Date(inv.due_date) : null;
                  return (
                    <React.Fragment key={inv.id}>
                    <div className="grid grid-cols-4 items-center px-4 py-3">
                      <div>
                        <p className="text-gray-700 text-sm font-medium">
                          {dueDate ? dueDate.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : '—'}
                        </p>
                        {inv.description && (
                          <p className="text-gray-400 text-xs truncate max-w-24">{inv.description}</p>
                        )}
                        {inv.discount_lines?.length > 0 && (
                          <p className="text-emerald-600 text-xs">
                            Discount: {R(inv.discount_total)}
                          </p>
                        )}
                      </div>
                      <p className="text-gray-600 text-sm text-right">
                        {R(inv.net_due ?? inv.amount_due)}
                        {inv.gross_charges != null && inv.discount_total > 0 && (
                          <span className="block text-[10px] text-gray-400">gross {R(inv.gross_charges)}</span>
                        )}
                      </p>
                      <p className="text-emerald-600 text-sm font-medium text-right">{R(inv.allocated_effective_payments ?? inv.amount_paid)}</p>
                      <div className="text-right">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                        {inv.status !== 'Paid' && inv.outstanding_balance > 0 && (
                          <p className="text-red-500 text-xs mt-0.5">{R(inv.outstanding_balance)} due</p>
                        )}
                      </div>
                    </div>
                    <div className="px-4 pb-3 text-xs text-gray-500">
                      {inv.snapshot_available && inv.line_items?.length > 0 ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {inv.line_items.map((line) => (
                            <span key={line.id || `${inv.id}-${line.label}`} className={line.line_type === 'discount' ? 'text-emerald-700' : ''}>
                              {line.is_included ? 'Included · ' : ''}{line.label}: {line.line_type === 'discount' ? '-' : ''}{R(line.amount)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>Detailed invoice snapshot unavailable for this legacy invoice.</span>
                      )}
                      <span className="ml-3">Credit {R(inv.credit || inv.overpaid_amount || 0)}</span>
                      {inv.review_required && (
                        <span className="ml-3 text-amber-700">
                          Review: {(inv.payment_review_flags || []).map((flag) => flag.type).join(', ')}
                        </span>
                      )}
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── PAY TAB ──────────────────────────────────────────────────────────── */}
      {tab === 'pay' && (
        <ParentPaymentProof child={child} embedded />
      )}
    </div>
  );
};

export default ParentInvoices;
