import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { CreditCard, AlertCircle, CheckCircle, Clock, TrendingDown } from 'lucide-react';

const STATUS_CONFIG = {
  Paid:      { label: 'Paid',     color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  Partial:   { label: 'Partial',  color: 'bg-amber-100 text-amber-700',    dot: 'bg-amber-500' },
  Unpaid:    { label: 'Unpaid',   color: 'bg-red-100 text-red-700',        dot: 'bg-red-500' },
  Overpaid:  { label: 'Overpaid', color: 'bg-blue-100 text-blue-700',      dot: 'bg-blue-500' },
};

const R = (n) => `R ${Number(n || 0).toFixed(2)}`;

const ParentInvoices = ({ child }) => {
  const [invoices, setInvoices] = useState([]);
  const [totals, setTotals] = useState({ totalDue: 0, totalPaid: 0, outstanding: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    parentApi('/invoices')
      .then((d) => { setInvoices(d.invoices || []); setTotals(d.totals || {}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">School Fees</h1>
        {child && (
          <p className="text-gray-500 text-sm mt-1">{child.first_name} {child.last_name} &bull; {child.student_number}</p>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-600 rounded-2xl p-4 text-white text-center">
          <p className="text-blue-200 text-xs font-medium">Total Billed</p>
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

      {/* Banking details */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
        <p className="text-blue-800 font-semibold text-sm mb-2">Banking Details</p>
        <div className="space-y-1 text-xs text-blue-700">
          <p><span className="font-medium">Bank:</span> First National Bank (FNB)</p>
          <p><span className="font-medium">Account Holder:</span> Harmony Learning Institute</p>
          <p><span className="font-medium">Account Number:</span> 63053202265</p>
          <p><span className="font-medium">Branch Code:</span> 210755</p>
          <p><span className="font-medium">Account Type:</span> Cheque</p>
          <p className="mt-2 text-blue-600 font-semibold">Reference: Use your child's student number ({child?.student_number || '—'})</p>
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          No invoices on record
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
                <div key={inv.id} className="grid grid-cols-4 items-center px-4 py-3">
                  <div>
                    <p className="text-gray-700 text-sm font-medium">
                      {dueDate ? dueDate.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : '—'}
                    </p>
                    {inv.description && (
                      <p className="text-gray-400 text-xs truncate max-w-24">{inv.description}</p>
                    )}
                  </div>
                  <p className="text-gray-600 text-sm text-right">{R(inv.amount_due)}</p>
                  <p className="text-emerald-600 text-sm font-medium text-right">{R(inv.amount_paid)}</p>
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ParentInvoices;
