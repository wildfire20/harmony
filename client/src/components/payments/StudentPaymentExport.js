import React, { useState } from 'react';
import { Search, Download, FileSpreadsheet, User, AlertCircle, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';

const StudentPaymentExport = () => {
  const { token } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleSearch = async (query) => {
    setSearchQuery(query);
    
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const response = await fetch(`/api/enhanced-invoices/search-students?q=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
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
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
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
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
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
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Paid':
      case 'Overpaid':
        return 'bg-green-100 text-green-800';
      case 'Missed Payment':
        return 'bg-red-100 text-red-800';
      case 'Partial Payment':
        return 'bg-orange-100 text-orange-800';
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
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'Partial Payment':
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
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount Paid</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Outstanding</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                      {paymentHistory.monthlyHistory.map((month, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{month.year}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{month.month}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">R {month.amountDue.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400">R {month.amountPaid.toFixed(2)}</td>
                          <td className={`px-4 py-3 text-sm text-right font-medium ${month.outstanding > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                            R {month.outstanding.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              {getStatusIcon(month.paymentStatus)}
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(month.paymentStatus)}`}>
                                {month.paymentStatus}
                              </span>
                            </div>
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
    </div>
  );
};

export default StudentPaymentExport;
