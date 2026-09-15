import React, { useState } from 'react';
import { Search, Download, FileSpreadsheet, User, AlertCircle, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const StudentPaymentExport = () => {
  const { token, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [legacyTarget, setLegacyTarget] = useState(null);
  const [legacyCategory, setLegacyCategory] = useState('tuition');
  const [legacyReason, setLegacyReason] = useState('');
  const [legacySaving, setLegacySaving] = useState(false);

  const handleSessionExpired = () => {
    toast.error('Your session has expired. Please log in again.');
    if (logout) logout();
    setTimeout(() => { window.location.href = '/login'; }, 1500);
  };

  const handleSearch = async (query) => {
    setSearchQuery(query);
    
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const response = await fetch(`/api/enhanced-invoices/search-students?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401) { handleSessionExpired(); return; }
      
      const data = await response.json();
      if (data.success) {
        setSearchResults(data.students);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectStudent = async (student) => {
    setSelectedStudent(student);
    setSearchResults([]);
    setSearchQuery('');
    setLoading(true);
    
    try {
      const response = await fetch(`/api/enhanced-invoices/student-payment-history/${student.studentNumber}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401) { handleSessionExpired(); return; }
      
      const data = await response.json();
      if (data.success) {
        setPaymentHistory(data);
      } else {
        toast.error(data.message || 'Failed to load payment history');
      }
    } catch (error) {
      console.error('Error loading payment history:', error);
      toast.error('Failed to load payment history');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    if (!selectedStudent) return;
    
    setExporting(true);
    try {
      const response = await fetch(`/api/enhanced-invoices/student-payment-history/${selectedStudent.studentNumber}?format=excel`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401) { handleSessionExpired(); return; }
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payment_History_${selectedStudent.studentNumber}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
      toast.success('Excel file downloaded successfully!');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download Excel file');
    } finally {
      setExporting(false);
    }
  };

  const clearSelection = () => {
    setSelectedStudent(null);
    setPaymentHistory(null);
    setLegacyTarget(null);
  };

  const submitLegacyClassification = async (event) => {
    event.preventDefault();
    if (!legacyTarget || legacyReason.trim().length < 10) {
      toast.error('A meaningful reason of at least 10 characters is required.');
      return;
    }
    setLegacySaving(true);
    try {
      const response = await fetch(`/api/invoices/${legacyTarget.invoiceId}/classify-legacy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: legacyCategory, reason: legacyReason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not classify existing invoice');
      toast.success(data.message || 'Existing invoice classified');
      setLegacyTarget(null);
      selectStudent(selectedStudent);
    } catch (error) {
      toast.error(error.message || 'Could not classify existing invoice');
    } finally {
      setLegacySaving(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Paid':
      case 'Overpaid':
        return 'bg-green-100 text-green-800';
      case 'Missed Payment':
      case 'Overdue / Missed':
        return 'bg-red-100 text-red-800';
      case 'Partial Payment':
      case 'Partial':
        return 'bg-orange-100 text-orange-800';
      case 'Due / Unpaid':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Paid':
      case 'Overpaid':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'Missed Payment':
      case 'Overdue / Missed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'Partial Payment':
      case 'Partial':
        return <AlertCircle className="w-4 h-4 text-orange-600" />;
      default:
        return null;
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <FileSpreadsheet className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Student Payment History Export</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Search for a student and download their payment history as Excel</p>
        </div>
      </div>

      {!selectedStudent ? (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by student number (e.g., HAR001) or name..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
              </div>
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 max-h-64 overflow-y-auto">
              {searchResults.map((student) => (
                <button
                  key={student.id}
                  onClick={() => selectStudent(student)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600 last:border-0 text-left"
                >
                  <div className="p-2 bg-gray-100 dark:bg-gray-600 rounded-full">
                    <User className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{student.fullName}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{student.studentNumber} - {student.grade || 'N/A'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-full">
                <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{selectedStudent.fullName}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{selectedStudent.studentNumber} - {selectedStudent.grade || 'N/A'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadExcel}
                disabled={exporting || !paymentHistory}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Download Excel
              </button>
              <button
                onClick={clearSelection}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Clear
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent"></div>
            </div>
          ) : paymentHistory ? (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Due</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">R {paymentHistory.summary.totalDue.toFixed(2)}</p>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-sm text-green-600 dark:text-green-400">Total Paid</p>
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">R {paymentHistory.summary.totalPaid.toFixed(2)}</p>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-sm text-red-600 dark:text-red-400">Outstanding</p>
                  <p className="text-xl font-bold text-red-700 dark:text-red-400">R {paymentHistory.summary.totalOutstanding.toFixed(2)}</p>
                </div>
                <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <p className="text-sm text-orange-600 dark:text-orange-400">Missed Payments</p>
                  <p className="text-xl font-bold text-orange-700 dark:text-orange-400">{paymentHistory.summary.missedPayments}</p>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-sm text-blue-600 dark:text-blue-400">Credit / Overpaid</p>
                  <p className="text-xl font-bold text-blue-700 dark:text-blue-400">
                    R {(paymentHistory.summary.credit || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {paymentHistory.monthlyHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p className="text-lg">No invoices found for this student</p>
                  <p className="text-sm mt-2">Generate invoices first to see payment history</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Year</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Month</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount Due</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Discount</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount Paid</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Outstanding</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Credit</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status / reconciliation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                      {paymentHistory.monthlyHistory.map((month, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{month.year}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{month.month}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">R {month.amountDue.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-right text-emerald-600 dark:text-emerald-400">
                            R {((month.discountLines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0)).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400">R {month.amountPaid.toFixed(2)}</td>
                          <td className={`px-4 py-3 text-sm text-right font-medium ${month.outstanding > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                            R {month.outstanding.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-blue-600 dark:text-blue-400">R {(month.credit || 0).toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              {getStatusIcon(month.paymentStatus)}
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(month.paymentStatus)}`}>
                                {month.paymentStatus}
                              </span>
                            </div>
                            {month.reconciliationState === 'REQUIRES_RECONCILIATION' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setLegacyTarget(month);
                                  setLegacyCategory('tuition');
                                  setLegacyReason('');
                                }}
                                className="mt-2 text-xs px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-700"
                              >
                                Classify existing invoice
                              </button>
                            )}
                            {month.carryForwardHistory && (
                              <div className="mt-2 text-xs text-slate-600 font-medium">
                                Carried forward history · classification unavailable
                              </div>
                            )}
                            {month.reconciliation?.state === 'RECONCILED' && (
                              <div className="mt-2 text-xs text-emerald-700">
                                Reconciled as {String(month.reconciliation.category || '').replaceAll('_', ' ')}
                                {month.reconciliation.actor_name ? ` by ${month.reconciliation.actor_name}` : ''}
                                {month.reconciliation.classified_at ? ` on ${new Date(month.reconciliation.classified_at).toLocaleString()}` : ''}
                                {month.reconciliation.reason ? ` — ${month.reconciliation.reason}` : ''}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
      {legacyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <form onSubmit={submitLegacyClassification} className="w-full max-w-lg mx-4 rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Classify Existing Invoice</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Invoice #{legacyTarget.invoiceId} · {legacyTarget.month} {legacyTarget.year} · preserves the existing balance
                </p>
              </div>
              <button type="button" onClick={() => setLegacyTarget(null)} className="text-gray-400">×</button>
            </div>
            <label className="mt-4 block text-sm font-medium text-gray-700">
              Category
              <select value={legacyCategory} onChange={(event) => setLegacyCategory(event.target.value)}
                className="mt-1 w-full rounded border border-gray-300 p-2">
                <option value="tuition">Tuition</option>
                <option value="boarding">Boarding</option>
                <option value="transport">Transport</option>
                <option value="aftercare">Aftercare</option>
                <option value="other_recurring">Other recurring</option>
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-700">
              Reason
              <textarea required minLength={10} maxLength={500} rows={4} value={legacyReason}
                onChange={(event) => setLegacyReason(event.target.value)}
                className="mt-1 w-full rounded border border-gray-300 p-2"
                placeholder="Explain how the existing invoice was confirmed." />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setLegacyTarget(null)} className="rounded border px-4 py-2 text-gray-700">Cancel</button>
              <button type="submit" disabled={legacySaving} className="rounded bg-amber-600 px-4 py-2 text-white disabled:opacity-50">
                {legacySaving ? 'Saving…' : 'Classify invoice'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default StudentPaymentExport;
