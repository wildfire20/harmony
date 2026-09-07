import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { ADMISSIONS_STATUSES, statusLabel } from '../../data/admissionsStatuses';

const badgeStyles = {
  NEW: 'bg-yellow-100 text-yellow-800',
  UNDER_REVIEW: 'bg-blue-100 text-blue-800',
  MORE_INFORMATION_REQUIRED: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-green-100 text-green-800',
  REGISTRATION_PENDING: 'bg-purple-100 text-purple-800',
  REGISTERED: 'bg-emerald-100 text-emerald-800',
  NOT_ACCEPTED: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  waitlisted: 'bg-blue-100 text-blue-800',
};

const StatusBadge = ({ status }) => (
  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badgeStyles[status] || 'bg-gray-100 text-gray-800'}`}>
    {statusLabel(status)}
  </span>
);

const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-ZA', {
  year: 'numeric', month: 'short', day: 'numeric',
}) : '—';

const EnrollmentManagement = () => {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0 });
  const [filter, setFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedEnrollment, setSelectedEnrollment] = useState(null);
  const [nextStatus, setNextStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [parentMessage, setParentMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchEnrollments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/enrollments', { params: { status: filter || undefined, search: search || undefined } });
      setEnrollments(response.data.enrollments || []);
    } catch (error) {
      console.error('Error fetching enrollments:', error);
      toast.error('Failed to fetch applications');
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await api.get('/enrollments/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  useEffect(() => { fetchEnrollments(); fetchStats(); }, [fetchEnrollments, fetchStats]);

  const openEnrollment = async (enrollment) => {
    try {
      const response = await api.get(`/enrollments/${enrollment.id}`);
      setSelectedEnrollment(response.data);
      setNextStatus(ADMISSIONS_STATUSES.some(({ value }) => value === response.data.status) ? response.data.status : '');
      setAdminNotes(response.data.admin_notes || '');
      setParentMessage('');
    } catch {
      toast.error('Failed to open application');
    }
  };

  const closeEnrollment = () => {
    setSelectedEnrollment(null);
    setNextStatus('');
    setAdminNotes('');
    setParentMessage('');
  };

  const handleStatusUpdate = async () => {
    if (!nextStatus || nextStatus === selectedEnrollment.status) {
      toast('Choose a different status to save an update');
      return;
    }
    try {
      setActionLoading(true);
      const response = await api.put(`/enrollments/${selectedEnrollment.id}/status`, {
        status: nextStatus,
        adminNotes,
        parentMessage,
      });
      toast.success(`Application changed to ${statusLabel(nextStatus)}`);
      if (response.data.emailSent) toast.success('Parent status email sent');
      closeEnrollment();
      fetchEnrollments();
      fetchStats();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const runSearch = (event) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">Admissions Applications</h1>
        <p className="text-gray-600 dark:text-gray-400">Review, search and manage prospective learner applications</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <button type="button" onClick={() => setFilter('')} className={`rounded-lg border p-3 text-left ${!filter ? 'border-pink-500 bg-pink-50' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
          <span className="block text-xl font-bold dark:text-white">{stats.total || 0}</span>
          <span className="text-xs text-gray-500">All</span>
        </button>
        {ADMISSIONS_STATUSES.map(({ value, label }) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg border p-3 text-left ${filter === value ? 'border-pink-500 bg-pink-50' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
            <span className="block text-xl font-bold dark:text-white">{stats[value] || 0}</span>
            <span className="text-xs text-gray-500">{label}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <form onSubmit={runSearch} className="flex flex-col gap-2 border-b border-gray-200 p-4 sm:flex-row dark:border-gray-700">
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="min-h-10 flex-1 rounded-lg border border-gray-300 px-3 dark:border-gray-600 dark:bg-gray-900 dark:text-white" placeholder="Search reference, learner, parent, email or phone" />
          <button className="min-h-10 rounded-lg bg-pink-500 px-5 font-medium text-white hover:bg-pink-600" type="submit">Search</button>
          {(search || searchInput) && <button type="button" onClick={() => { setSearchInput(''); setSearch(''); }} className="min-h-10 rounded-lg border border-gray-300 px-4 dark:border-gray-600 dark:text-white">Clear</button>}
        </form>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading applications…</div>
        ) : enrollments.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No applications found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {['Reference', 'Learner', 'Parent / contact', 'Applying for', 'Status', 'Applied', ''].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {enrollments.map((enrollment) => (
                  <tr key={enrollment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-4 font-mono text-sm font-bold text-blue-900 dark:text-blue-300">{enrollment.application_reference || `Legacy #${enrollment.id}`}</td>
                    <td className="px-4 py-4"><span className="font-medium text-gray-900 dark:text-white">{enrollment.student_first_name} {enrollment.student_last_name}</span></td>
                    <td className="px-4 py-4 text-sm"><p className="font-medium dark:text-white">{enrollment.parent_first_name} {enrollment.parent_last_name}</p><p className="text-gray-500">{enrollment.parent_email}</p><p className="text-gray-500">{enrollment.parent_phone}</p></td>
                    <td className="px-4 py-4 text-sm dark:text-white">{enrollment.grade_applying}{enrollment.boarding_option && <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">Boarding</span>}</td>
                    <td className="px-4 py-4"><StatusBadge status={enrollment.status} /></td>
                    <td className="px-4 py-4 text-sm text-gray-500">{formatDate(enrollment.created_at)}</td>
                    <td className="px-4 py-4"><button type="button" onClick={() => openEnrollment(enrollment)} className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedEnrollment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white dark:bg-gray-800">
            <div className="flex items-start justify-between border-b border-gray-200 p-6 dark:border-gray-700">
              <div><p className="font-mono text-sm font-bold text-blue-800 dark:text-blue-300">{selectedEnrollment.application_reference || `Legacy application #${selectedEnrollment.id}`}</p><h2 className="mt-1 text-xl font-bold dark:text-white">Application Details</h2></div>
              <button type="button" onClick={closeEnrollment} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button>
            </div>
            <div className="space-y-6 p-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div><h3 className="mb-2 text-sm font-medium text-gray-500">Learner</h3><p className="font-medium dark:text-white">{selectedEnrollment.student_first_name} {selectedEnrollment.student_last_name}</p><p className="text-sm text-gray-600 dark:text-gray-400">DOB: {formatDate(selectedEnrollment.student_date_of_birth)}</p><p className="text-sm text-gray-600 dark:text-gray-400">Grade: {selectedEnrollment.grade_applying}</p></div>
                <div><h3 className="mb-2 text-sm font-medium text-gray-500">Parent / guardian</h3><p className="font-medium dark:text-white">{selectedEnrollment.parent_first_name} {selectedEnrollment.parent_last_name}</p><p className="text-sm text-gray-600 dark:text-gray-400">{selectedEnrollment.parent_email}</p><p className="text-sm text-gray-600 dark:text-gray-400">{selectedEnrollment.parent_phone}</p></div>
              </div>
              {selectedEnrollment.additional_notes && <div><h3 className="mb-2 text-sm font-medium text-gray-500">Parent application note</h3><p className="rounded-lg bg-gray-50 p-3 text-gray-700 dark:bg-gray-900 dark:text-gray-300">{selectedEnrollment.additional_notes}</p></div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">New status<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"><option value="">{ADMISSIONS_STATUSES.some(({ value }) => value === selectedEnrollment.status) ? 'Select a status' : 'Choose a controlled status for this legacy application'}</option>{ADMISSIONS_STATUSES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Parent-safe message (optional)<textarea value={parentMessage} maxLength={1000} onChange={(event) => setParentMessage(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900" placeholder="Only text suitable for the parent email" /></label>
              </div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Internal Admin notes<textarea value={adminNotes} maxLength={4000} onChange={(event) => setAdminNotes(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900" placeholder="Never included in parent emails" /></label>
              {selectedEnrollment.status_history?.length > 0 && <div><h3 className="mb-2 text-sm font-medium text-gray-500">Status history</h3><div className="space-y-2">{selectedEnrollment.status_history.map((item, index) => <div key={`${item.created_at}-${index}`} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900"><StatusBadge status={item.new_status} /> <span className="ml-2 text-gray-500">{formatDate(item.created_at)}</span></div>)}</div></div>}
              {selectedEnrollment.email_delivery?.some((item) => item.delivery_status === 'failed') && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">Email follow-up required</p><p className="mt-1">One or more admissions emails could not be delivered. Please contact the parent or resend the update after checking email service availability.</p></div>}
              <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700"><button type="button" onClick={closeEnrollment} className="rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:text-white">Cancel</button><button type="button" onClick={handleStatusUpdate} disabled={actionLoading || !nextStatus || nextStatus === selectedEnrollment.status} className="rounded-lg bg-pink-500 px-5 py-2 font-medium text-white hover:bg-pink-600 disabled:opacity-50">{actionLoading ? 'Saving…' : 'Save status update'}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnrollmentManagement;