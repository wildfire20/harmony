import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Filter, ChevronLeft, ChevronRight, RefreshCw, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../common/LoadingSpinner';

const ACTION_COLOURS = {
  manual_payment_add:      'bg-green-100 text-green-800',
  manual_payment_edit:     'bg-blue-100  text-blue-800',
  manual_payment_delete:   'bg-red-100   text-red-800',
  manual_payment_arrears:  'bg-purple-100 text-purple-800',
  bank_statement_upload:   'bg-indigo-100 text-indigo-800',
  invoice_generate:        'bg-cyan-100  text-cyan-800',
  invoice_delete:          'bg-red-100   text-red-800',
  invoice_carry_forward:   'bg-amber-100 text-amber-800',
  manual_arrears_created:  'bg-amber-100 text-amber-800',
  payment_proof_approve:   'bg-green-100 text-green-800',
  payment_proof_reject:    'bg-red-100   text-red-800',
  payment_proof_delete:    'bg-red-100   text-red-800',
  student_create:          'bg-teal-100  text-teal-800',
  student_update:          'bg-blue-100  text-blue-800',
  student_delete:          'bg-red-100   text-red-800',
  password_reset:          'bg-orange-100 text-orange-800',
};

const ENTITY_ICONS = {
  payment:       '💳',
  invoice:       '🧾',
  student:       '🎓',
  payment_proof: '📄',
  bank_upload:   '🏦',
};

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function DetailsBadge({ details }) {
  if (!details || typeof details !== 'object') return null;
  const items = Object.entries(details).filter(([k]) => !['error'].includes(k));
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.slice(0, 4).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">
          <span className="text-gray-400">{k.replace(/_/g, ' ')}:</span>
          <span className="font-medium">{String(v).substring(0, 40)}</span>
        </span>
      ))}
    </div>
  );
}

const AuditLog = () => {
  const { token } = useAuth();
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50, totalPages: 1 });
  const [actions,    setActions]    = useState([]);

  const [filters, setFilters] = useState({
    action:     '',
    entityType: '',
    dateFrom:   '',
    dateTo:     '',
    search:     '',
  });
  const [applied, setApplied] = useState(filters);
  const [page,    setPage]    = useState(1);

  const fetchLogs = useCallback(async (f, p) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page:       p,
        limit:      50,
        action:     f.action,
        entityType: f.entityType,
        dateFrom:   f.dateFrom,
        dateTo:     f.dateTo,
        search:     f.search,
      });
      const res  = await fetch(`/api/audit-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
        setPagination(data.pagination);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);

  const fetchActions = useCallback(async () => {
    try {
      const res  = await fetch('/api/audit-logs/actions', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setActions(data.actions);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchActions(); }, [fetchActions]);
  useEffect(() => { fetchLogs(applied, page); }, [fetchLogs, applied, page]);

  const handleApply = () => { setApplied({ ...filters }); setPage(1); };
  const handleReset = () => {
    const blank = { action: '', entityType: '', dateFrom: '', dateTo: '', search: '' };
    setFilters(blank); setApplied(blank); setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-600" />
          Audit Log
        </h2>
        <button
          onClick={() => fetchLogs(applied, page)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        Every action performed by admins and staff is recorded here — payments, invoice changes, student updates, and more.
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-4">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search…"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleApply()}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <select
            value={filters.action}
            onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
            className="py-2 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All actions</option>
            {actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select
            value={filters.entityType}
            onChange={e => setFilters(f => ({ ...f, entityType: e.target.value }))}
            className="py-2 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All entities</option>
            <option value="payment">Payment</option>
            <option value="invoice">Invoice</option>
            <option value="student">Student</option>
            <option value="payment_proof">Payment proof</option>
            <option value="bank_upload">Bank upload</option>
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            className="py-2 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
            className="py-2 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleApply}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >Apply</button>
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >Clear</button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center"><LoadingSpinner /></div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Clock className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No audit records found{Object.values(applied).some(Boolean) ? ' for these filters' : ' yet'}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">When</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Who</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium text-gray-900">{log.user_name || 'System'}</p>
                      {log.user_role && (
                        <p className="text-xs text-gray-400 capitalize">{log.user_role.replace('_', ' ')}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLOURS[log.action] || 'bg-gray-100 text-gray-700'}`}>
                        {log.action_label || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {log.entity_type ? (
                        <span>{ENTITY_ICONS[log.entity_type] || '📋'} {log.entity_type}{log.entity_id ? ` #${log.entity_id}` : ''}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                      {log.details?.summary && <p>{log.details.summary}</p>}
                      <DetailsBadge details={log.details} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {pagination.total} record{pagination.total !== 1 ? 's' : ''}
              {' · '} page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              ><ChevronLeft className="h-4 w-4" /></button>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="p-1.5 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
              ><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLog;
