import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { CheckCircle, XCircle, Clock, MinusCircle, AlertCircle } from 'lucide-react';

const STATUS_CONFIG = {
  present: { label: 'Present', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', icon: CheckCircle },
  absent:  { label: 'Absent',  color: 'bg-red-100 text-red-700',         dot: 'bg-red-500',     icon: XCircle },
  late:    { label: 'Late',    color: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   icon: Clock },
  excused: { label: 'Excused', color: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500',    icon: MinusCircle },
};

const MONTHS = [
  '', 'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const ParentAttendance = ({ child }) => {
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const load = () => {
    setLoading(true);
    parentApi(`/attendance?month=${month}&year=${year}`)
      .then((d) => { setRecords(d.records || []); setSummary(d.summary || {}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [month, year]);

  const years = [now.getFullYear() - 1, now.getFullYear()];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Attendance Record</h1>
        {child && (
          <p className="text-gray-500 text-sm mt-1">{child.first_name} {child.last_name} &bull; {child.grade_name}</p>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={month}
          onChange={(e) => setMonth(+e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          {MONTHS.slice(1).map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(+e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-2 ${cfg.color}`}>
              <cfg.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-gray-800">{summary[key] || 0}</p>
            <p className="text-gray-400 text-xs">{cfg.label}</p>
          </div>
        ))}
      </div>

      {/* Records list */}
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
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          No attendance records for {MONTHS[month]} {year}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="grid grid-cols-3 text-xs font-semibold text-gray-400 uppercase px-4 py-2.5 border-b border-gray-50">
            <span>Date</span>
            <span>Status</span>
            <span>Notes</span>
          </div>
          <div className="divide-y divide-gray-50">
            {records.map((r) => {
              const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.present;
              return (
                <div key={r.id} className="grid grid-cols-3 items-center px-4 py-3">
                  <span className="text-gray-700 text-sm font-medium">
                    {new Date(r.date).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full w-fit ${cfg.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                  <span className="text-gray-400 text-xs truncate">{r.notes || '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ParentAttendance;
