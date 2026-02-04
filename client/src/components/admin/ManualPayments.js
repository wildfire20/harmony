import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { DollarSign, Search, Plus, Edit, Trash2, Check, X } from 'lucide-react';
import { paymentsAPI, adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const ManualPayments = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentData, setPaymentData] = useState({
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    description: '',
    reference: '',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  });
  const queryClient = useQueryClient();

  const { data: studentsData, isLoading: searchLoading } = useQuery(
    ['searchStudents', activeSearch],
    () => paymentsAPI.searchStudents(activeSearch),
    {
      enabled: activeSearch.length >= 2,
      staleTime: 30000
    }
  );

  const { data: paymentsData, isLoading: paymentsLoading } = useQuery(
    ['studentPayments', selectedStudent?.id],
    () => paymentsAPI.getStudentPayments(selectedStudent?.id),
    {
      enabled: !!selectedStudent?.id
    }
  );

  const addPaymentMutation = useMutation(
    (data) => paymentsAPI.addManualPayment(data),
    {
      onSuccess: (response) => {
        toast.success(response.data?.message || 'Payment recorded successfully');
        queryClient.invalidateQueries(['studentPayments', selectedStudent?.id]);
        resetPaymentForm();
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to record payment');
      }
    }
  );

  const updatePaymentMutation = useMutation(
    ({ paymentId, data }) => paymentsAPI.updateManualPayment(paymentId, data),
    {
      onSuccess: () => {
        toast.success('Payment updated successfully');
        queryClient.invalidateQueries(['studentPayments', selectedStudent?.id]);
        setEditingPayment(null);
        resetPaymentForm();
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to update payment');
      }
    }
  );

  const deletePaymentMutation = useMutation(
    (paymentId) => paymentsAPI.deleteManualPayment(paymentId),
    {
      onSuccess: () => {
        toast.success('Payment deleted successfully');
        queryClient.invalidateQueries(['studentPayments', selectedStudent?.id]);
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete payment');
      }
    }
  );

  const handleSearch = () => {
    setActiveSearch(searchTerm);
  };

  const handleSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSelectStudent = (student) => {
    setSelectedStudent(student);
    setSearchTerm('');
    setActiveSearch('');
  };

  const resetPaymentForm = () => {
    setShowPaymentForm(false);
    setPaymentData({
      amount: '',
      payment_date: new Date().toISOString().split('T')[0],
      description: '',
      reference: '',
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    });
  };

  const handleSubmitPayment = (e) => {
    e.preventDefault();
    if (!selectedStudent) {
      toast.error('Please select a student first');
      return;
    }
    if (!paymentData.amount || parseFloat(paymentData.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (editingPayment) {
      updatePaymentMutation.mutate({
        paymentId: editingPayment.id,
        data: paymentData
      });
    } else {
      addPaymentMutation.mutate({
        student_id: selectedStudent.id,
        ...paymentData,
        amount: parseFloat(paymentData.amount)
      });
    }
  };

  const handleEditPayment = (payment) => {
    setEditingPayment(payment);
    setPaymentData({
      amount: payment.amount,
      payment_date: payment.payment_date?.split('T')[0] || '',
      description: payment.description || '',
      reference: payment.reference || '',
      month: payment.month,
      year: payment.year
    });
    setShowPaymentForm(true);
  };

  const handleDeletePayment = (paymentId) => {
    if (window.confirm('Are you sure you want to delete this payment? This will update the invoice balance.')) {
      deletePaymentMutation.mutate(paymentId);
    }
  };

  const students = studentsData?.data?.students || studentsData?.students || [];
  const payments = paymentsData?.data?.payments || paymentsData?.payments || [];

  const months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-green-600" />
          Manual Payment Entry
        </h2>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800 text-sm">
          Use this feature to manually record payments when parents didn't use the student number as a reference. 
          Search for the student, then add the payment amount and date.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Step 1: Find Student</h3>
        
        <div className="flex space-x-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or student number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <button
            onClick={handleSearch}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
          >
            Search
          </button>
        </div>

        {searchLoading && <LoadingSpinner />}

        {students.length > 0 && (
          <div className="border border-gray-200 rounded-md max-h-48 overflow-y-auto mb-4">
            {students.map((student) => (
              <button
                key={student.id}
                onClick={() => handleSelectStudent(student)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
              >
                <div className="font-medium">{student.fullName}</div>
                <div className="text-sm text-gray-500">Student #: {student.studentNumber}</div>
              </button>
            ))}
          </div>
        )}

        {selectedStudent && (
          <div className="bg-green-50 border border-green-200 rounded-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-green-800">Selected: {selectedStudent.fullName || `${selectedStudent.firstName} ${selectedStudent.lastName}`}</p>
                <p className="text-sm text-green-600">Student #: {selectedStudent.studentNumber}</p>
              </div>
              <button
                onClick={() => setSelectedStudent(null)}
                className="text-green-600 hover:text-green-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedStudent && (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Step 2: Add Payment</h3>
              {!showPaymentForm && (
                <button
                  onClick={() => setShowPaymentForm(true)}
                  className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Payment
                </button>
              )}
            </div>

            {showPaymentForm && (
              <form onSubmit={handleSubmitPayment} className="space-y-4 bg-gray-50 p-4 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount (R) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={paymentData.amount}
                      onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date *</label>
                    <input
                      type="date"
                      value={paymentData.payment_date}
                      onChange={(e) => setPaymentData({ ...paymentData, payment_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">For Month</label>
                    <select
                      value={paymentData.month}
                      onChange={(e) => setPaymentData({ ...paymentData, month: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                    >
                      {months.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                    <input
                      type="number"
                      value={paymentData.year}
                      onChange={(e) => setPaymentData({ ...paymentData, year: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bank Reference</label>
                    <input
                      type="text"
                      value={paymentData.reference}
                      onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })}
                      placeholder="Original bank reference (if known)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <input
                      type="text"
                      value={paymentData.description}
                      onChange={(e) => setPaymentData({ ...paymentData, description: e.target.value })}
                      placeholder="e.g., Parent name, reason for manual entry"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                  </div>
                </div>
                <div className="flex space-x-3">
                  <button
                    type="submit"
                    disabled={addPaymentMutation.isLoading || updatePaymentMutation.isLoading}
                    className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Check className="h-4 w-4" />
                    {editingPayment ? 'Update Payment' : 'Record Payment'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetPaymentForm();
                      setEditingPayment(null);
                    }}
                    className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment History</h3>
            
            {paymentsLoading ? (
              <LoadingSpinner />
            ) : payments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">For Month</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {payments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {new Date(payment.payment_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-green-600">
                          R {parseFloat(payment.amount).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {months.find(m => m.value === payment.month)?.label} {payment.year}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {payment.reference || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            payment.payment_method === 'manual_entry' 
                              ? 'bg-yellow-100 text-yellow-800' 
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {payment.payment_method === 'manual_entry' ? 'Manual' : 'Bank Import'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm space-x-2">
                          <button
                            onClick={() => handleEditPayment(payment)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeletePayment(payment.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No payments recorded for this student yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ManualPayments;
