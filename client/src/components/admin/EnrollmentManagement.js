import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';

const EnrollmentManagement = () => {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, waitlisted: 0, total: 0 });
  const [filter, setFilter] = useState('');
  const [selectedEnrollment, setSelectedEnrollment] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => {
    fetchEnrollments();
    fetchStats();
  }, [filter]);

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      const params = filter ? `?status=${filter}` : '';
      const response = await api.get(`/enrollments${params}`);
      setEnrollments(response.data.enrollments || []);
    } catch (error) {
      console.error('Error fetching enrollments:', error);
      toast.error('Failed to fetch enrollments');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/enrollments/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleStatusUpdate = async (id, status) => {
    try {
      setActionLoading(true);
      await api.put(`/enrollments/${id}/status`, { status, adminNotes });
      toast.success(`Application ${status}`);
      setSelectedEnrollment(null);
      setAdminNotes('');
      fetchEnrollments();
      fetchStats();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this application?')) return;
    
    try {
      await api.delete(`/enrollments/${id}`);
      toast.success('Application deleted');
      fetchEnrollments();
      fetchStats();
    } catch (error) {
      console.error('Error deleting enrollment:', error);
      toast.error('Failed to delete application');
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      waitlisted: 'bg-blue-100 text-blue-800'
    };
    return `inline-flex px-2 py-1 text-xs font-semibold rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Enrollment Applications</h1>
        <p className="text-gray-600 dark:text-gray-400">Review and manage prospective student applications</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Total</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{stats.pending}</div>
          <div className="text-sm text-yellow-600 dark:text-yellow-500">Pending</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
          <div className="text-2xl font-bold text-green-700 dark:text-green-400">{stats.approved}</div>
          <div className="text-sm text-green-600 dark:text-green-500">Approved</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
          <div className="text-2xl font-bold text-red-700 dark:text-red-400">{stats.rejected}</div>
          <div className="text-sm text-red-600 dark:text-red-500">Rejected</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{stats.waitlisted}</div>
          <div className="text-sm text-blue-600 dark:text-blue-500">Waitlisted</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
          <button 
            onClick={() => setFilter('')} 
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${!filter ? 'bg-pink-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            All
          </button>
          <button 
            onClick={() => setFilter('pending')} 
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === 'pending' ? 'bg-yellow-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Pending
          </button>
          <button 
            onClick={() => setFilter('approved')} 
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === 'approved' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Approved
          </button>
          <button 
            onClick={() => setFilter('rejected')} 
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === 'rejected' ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Rejected
          </button>
          <button 
            onClick={() => setFilter('waitlisted')} 
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filter === 'waitlisted' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            Waitlisted
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Loading applications...</p>
          </div>
        ) : enrollments.length === 0 ? (
          <div className="p-8 text-center">
            <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No enrollment applications found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Parent/Guardian</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Grade</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Applied</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {enrollments.map((enrollment) => (
                  <tr key={enrollment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-4">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {enrollment.student_first_name} {enrollment.student_last_name}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        DOB: {formatDate(enrollment.student_date_of_birth)}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {enrollment.parent_first_name} {enrollment.parent_last_name}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{enrollment.parent_email}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{enrollment.parent_phone}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-gray-900 dark:text-white">{enrollment.grade_applying}</span>
                      {enrollment.boarding_option && (
                        <span className="ml-2 inline-flex px-2 py-0.5 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 rounded-full">
                          Boarding
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={getStatusBadge(enrollment.status)}>{enrollment.status}</span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(enrollment.created_at)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedEnrollment(enrollment)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(enrollment.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedEnrollment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Application Details</h2>
              <button
                onClick={() => { setSelectedEnrollment(null); setAdminNotes(''); }}
                className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Student Information</h3>
                  <div className="space-y-2">
                    <p className="text-gray-900 dark:text-white font-medium">
                      {selectedEnrollment.student_first_name} {selectedEnrollment.student_last_name}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      DOB: {formatDate(selectedEnrollment.student_date_of_birth)}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Grade: {selectedEnrollment.grade_applying}
                    </p>
                    {selectedEnrollment.boarding_option && (
                      <p className="text-sm text-purple-600 dark:text-purple-400">Interested in Boarding</p>
                    )}
                    {selectedEnrollment.previous_school && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Previous School: {selectedEnrollment.previous_school}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Parent/Guardian Information</h3>
                  <div className="space-y-2">
                    <p className="text-gray-900 dark:text-white font-medium">
                      {selectedEnrollment.parent_first_name} {selectedEnrollment.parent_last_name}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{selectedEnrollment.parent_email}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{selectedEnrollment.parent_phone}</p>
                  </div>
                </div>
              </div>

              {selectedEnrollment.additional_notes && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Additional Notes from Parent</h3>
                  <p className="text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                    {selectedEnrollment.additional_notes}
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Admin Notes</h3>
                <textarea
                  value={adminNotes || selectedEnrollment.admin_notes || ''}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                  placeholder="Add notes about this application..."
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => handleStatusUpdate(selectedEnrollment.id, 'approved')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedEnrollment.id, 'waitlisted')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  Waitlist
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedEnrollment.id, 'rejected')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedEnrollment.id, 'pending')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-yellow-500 text-white font-medium rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50"
                >
                  Mark Pending
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnrollmentManagement;
