import React, { useState, useEffect, useCallback } from 'react';
import { Users, MapPin, LogOut, Clock, RefreshCw, Loader, AlertCircle, Download, Calendar } from 'lucide-react';
import { useTheme } from '../common/ThemeProvider';

// Return the Monday of the current week in YYYY-MM-DD
const getWeekStart = () => {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
};

// Return today in YYYY-MM-DD
const getToday = () => new Date().toISOString().split('T')[0];

const REFRESH_MS = 30000;

const statusConfig = {
  'on-site': {
    label: 'On Site',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-800 border-green-200',
    badgeDark: 'bg-green-900/40 text-green-300 border-green-700',
    icon: MapPin,
  },
  'signed-out': {
    label: 'Signed Out',
    dot: 'bg-blue-400',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    badgeDark: 'bg-blue-900/40 text-blue-300 border-blue-700',
    icon: LogOut,
  },
  'not-arrived': {
    label: 'Not Arrived',
    dot: 'bg-gray-400',
    badge: 'bg-gray-100 text-gray-600 border-gray-200',
    badgeDark: 'bg-gray-800 text-gray-400 border-gray-700',
    icon: Clock,
  },
};

const fmtTime = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
};

const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
};

const StaffAttendanceReport = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const token = localStorage.getItem('token');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Export state
  const [exportStart, setExportStart] = useState(getWeekStart);
  const [exportEnd, setExportEnd] = useState(getToday);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const fetchReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/staff-attendance/today', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setData(json);
        setLastRefresh(new Date());
      } else {
        setError(json.message || 'Failed to load report');
      }
    } catch {
      setError('Could not connect to the server');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReport();
    const interval = setInterval(() => fetchReport(true), REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchReport]);

  const handleExport = async () => {
    if (!exportStart || !exportEnd) {
      setExportError('Please select a start and end date');
      return;
    }
    if (exportStart > exportEnd) {
      setExportError('Start date must be before end date');
      return;
    }
    setExportError('');
    setExporting(true);
    try {
      const url = `/api/staff-attendance/export?start_date=${exportStart}&end_date=${exportEnd}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || 'Export failed');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Staff_Attendance_${exportStart}_to_${exportEnd}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (e) {
      setExportError(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const card = isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';

  const filteredStaff = (data?.staff || []).filter(s => {
    const matchFilter = filter === 'all' || s.status === filter;
    const matchSearch = `${s.first_name} ${s.last_name} ${s.role}`.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader className="w-7 h-7 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-2xl border p-8 text-center ${card}`}>
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
        <p className={`font-medium ${textPrimary}`}>{error}</p>
        <button onClick={() => fetchReport()} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Date & refresh header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className={`text-xl font-bold ${textPrimary}`}>Daily Attendance</h2>
          <p className={`text-sm mt-0.5 ${textSecondary}`}>{fmtDate(data?.date)}</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <p className={`text-xs ${textSecondary}`}>
              Updated {lastRefresh.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
          <button
            onClick={() => fetchReport()}
            className={`p-2 rounded-xl border transition-colors ${
              isDark ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { key: 'on_site', label: 'On Site', color: 'green', icon: MapPin },
            { key: 'signed_out', label: 'Signed Out', color: 'blue', icon: LogOut },
            { key: 'not_arrived', label: 'Not Arrived', color: 'gray', icon: Clock },
            { key: 'total', label: 'Total Staff', color: 'purple', icon: Users },
          ].map(({ key, label, color, icon: Icon }) => (
            <div key={key} className={`rounded-2xl border p-4 ${card}`}>
              <div className={`p-2 w-fit rounded-xl mb-3 ${
                color === 'green' ? 'bg-green-500/20' :
                color === 'blue' ? 'bg-blue-500/20' :
                color === 'purple' ? 'bg-purple-500/20' : 'bg-gray-500/20'
              }`}>
                <Icon className={`w-4 h-4 ${
                  color === 'green' ? 'text-green-500' :
                  color === 'blue' ? 'text-blue-500' :
                  color === 'purple' ? 'text-purple-500' : 'text-gray-500'
                }`} />
              </div>
              <p className={`text-2xl font-bold ${textPrimary}`}>{data.summary[key]}</p>
              <p className={`text-xs mt-0.5 ${textSecondary}`}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Export panel */}
      <div className={`rounded-2xl border p-5 ${card}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-xl">
            <Download className="w-4 h-4 text-white" />
          </div>
          <h3 className={`font-semibold ${textPrimary}`}>Export to Excel</h3>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-36">
            <label className={`block text-xs font-medium mb-1 ${textSecondary}`}>From</label>
            <input
              type="date"
              value={exportStart}
              onChange={e => setExportStart(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'
              }`}
            />
          </div>
          <div className="flex-1 min-w-36">
            <label className={`block text-xs font-medium mb-1 ${textSecondary}`}>To</label>
            <input
              type="date"
              value={exportEnd}
              onChange={e => setExportEnd(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'
              }`}
            />
          </div>

          {/* Quick shortcuts */}
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'This Week', fn: () => { setExportStart(getWeekStart()); setExportEnd(getToday()); } },
              { label: 'Last 7 Days', fn: () => { const d = new Date(); d.setDate(d.getDate() - 6); setExportStart(d.toISOString().split('T')[0]); setExportEnd(getToday()); } },
              { label: 'This Month', fn: () => { const d = new Date(); setExportStart(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`); setExportEnd(getToday()); } },
            ].map(s => (
              <button key={s.label} onClick={s.fn}
                className={`px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                  isDark ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >{s.label}</button>
            ))}
          </div>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-60 shadow-lg shadow-green-600/25"
          >
            {exporting ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Generating…' : 'Download Excel'}
          </button>
        </div>

        {exportError && (
          <p className="mt-2 text-red-500 text-xs">{exportError}</p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {['all', 'on-site', 'signed-out', 'not-arrived'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              filter === f
                ? 'bg-blue-600 border-blue-600 text-white'
                : isDark
                  ? 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {f === 'all' ? 'All' : statusConfig[f]?.label}
          </button>
        ))}
        <input
          type="text"
          placeholder="Search staff…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`ml-auto px-3 py-1.5 rounded-xl border text-xs w-36 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isDark ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
          }`}
        />
      </div>

      {/* Staff table */}
      <div className={`rounded-2xl border overflow-hidden ${card}`}>
        {/* Desktop header */}
        <div className={`hidden md:grid grid-cols-12 gap-3 px-5 py-3 text-xs font-semibold uppercase tracking-wide ${
          isDark ? 'bg-gray-800/60 text-gray-400 border-b border-gray-800' : 'bg-gray-50 text-gray-500 border-b border-gray-100'
        }`}>
          <div className="col-span-4">Staff Member</div>
          <div className="col-span-2">Role</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Time In</div>
          <div className="col-span-2">Time Out</div>
        </div>

        {filteredStaff.length === 0 ? (
          <div className={`text-center py-12 ${textSecondary}`}>
            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No staff match the current filter</p>
          </div>
        ) : (
          <div className={`divide-y ${isDark ? 'divide-gray-800' : 'divide-gray-100'}`}>
            {filteredStaff.map(s => {
              const cfg = statusConfig[s.status];
              const BadgeIcon = cfg?.icon;
              return (
                <div
                  key={s.id}
                  className={`grid grid-cols-2 md:grid-cols-12 gap-x-3 gap-y-1 px-5 py-4 items-center ${
                    isDark ? 'hover:bg-gray-800/40' : 'hover:bg-gray-50'
                  } transition-colors`}
                >
                  {/* Name */}
                  <div className="col-span-2 md:col-span-4 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                      isDark ? 'bg-blue-900 text-blue-300' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {s.first_name?.[0]}{s.last_name?.[0]}
                    </div>
                    <div className="min-w-0">
                      <p className={`font-medium text-sm truncate ${textPrimary}`}>{s.first_name} {s.last_name}</p>
                      <p className={`text-xs truncate md:hidden ${textSecondary}`}>{s.role}</p>
                    </div>
                  </div>

                  {/* Role — desktop only */}
                  <div className={`hidden md:block md:col-span-2 text-sm capitalize ${textSecondary}`}>{s.role}</div>

                  {/* Status */}
                  <div className="col-span-1 md:col-span-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      isDark ? cfg?.badgeDark : cfg?.badge
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg?.dot} flex-shrink-0`} />
                      <span className="hidden sm:inline">{cfg?.label}</span>
                    </span>
                  </div>

                  {/* Time In */}
                  <div className={`col-span-1 md:col-span-2 text-sm font-mono ${textPrimary}`}>
                    <span className={`md:hidden text-xs ${textSecondary}`}>In: </span>
                    {fmtTime(s.time_in)}
                  </div>

                  {/* Time Out */}
                  <div className={`col-span-2 md:col-span-2 text-sm font-mono ${
                    s.time_out ? textPrimary : textSecondary
                  }`}>
                    <span className={`md:hidden text-xs ${textSecondary}`}>Out: </span>
                    {fmtTime(s.time_out)}
                    {!s.card_id && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        isDark ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-50 text-amber-600'
                      }`}>No card</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className={`text-xs text-center ${textSecondary}`}>Auto-refreshes every 30 seconds</p>
    </div>
  );
};

export default StaffAttendanceReport;
