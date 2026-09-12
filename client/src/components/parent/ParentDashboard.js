import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import {
  CheckCircle, XCircle, Clock, Bell,
  TrendingUp, AlertCircle, CreditCard, CalendarDays
} from 'lucide-react';

const StatCard = ({ label, value, sub, color, icon: Icon }) => (
   <div className={`parent-stat rounded-2xl p-4 flex items-center gap-4 ${color}`}>
    <div className="p-2.5 bg-white/20 rounded-xl">
      <Icon className="h-5 w-5 text-white" />
    </div>
    <div>
      <p className="text-white/80 text-xs font-medium">{label}</p>
      <p className="text-white text-2xl font-bold leading-tight">{value}</p>
      {sub && <p className="text-white/70 text-xs">{sub}</p>}
    </div>
  </div>
);

const ParentDashboard = ({ child, user }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [upcoming, setUpcoming] = useState([]);

  useEffect(() => {
    parentApi('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    parentApi('/calendar?upcoming=true').then(result => setUpcoming((result?.events || []).slice(0, 3))).catch(() => setUpcoming([]));
  }, [child?.id]);

  if (loading) return <div className="space-y-4"><div className="h-32 animate-pulse rounded-3xl bg-[#dfe9e7]" /><div className="grid grid-cols-2 gap-3"><div className="h-24 animate-pulse rounded-2xl bg-[#dfe9e7]" /><div className="h-24 animate-pulse rounded-2xl bg-[#dfe9e7]" /></div></div>;
  if (error) return (
    <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
      <AlertCircle className="h-5 w-5 shrink-0" />
      {error}
    </div>
  );

  const { weekAttendance, outstandingBalance, recentAnnouncements } = data || {};

  const attendanceRate = weekAttendance?.total > 0
    ? Math.round((parseInt(weekAttendance.present) / parseInt(weekAttendance.total)) * 100)
    : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b5473a]">Harmony Learning Institute</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#19324a]">Good day, {user?.first_name}</h1>
        {child ? (
          <p className="text-gray-500 text-sm mt-1">
            Viewing updates for <span className="font-semibold text-gray-700">{child.first_name} {child.last_name}</span>
            {' '}&bull; {child.grade_name} {child.class_name && `· ${child.class_name}`}
          </p>
        ) : (
          <p className="text-amber-600 text-sm mt-1 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            No student linked to your account. Please contact the school.
          </p>
        )}
      </div>

      {/* Attendance this week */}
      <section className="rounded-3xl border border-[#dce7eb] bg-white p-4 shadow-[0_12px_35px_rgba(31,65,83,.07)]">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#617487]">This week at a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Present" value={weekAttendance?.present ?? '–'} color="bg-emerald-500" icon={CheckCircle} />
          <StatCard label="Absent"  value={weekAttendance?.absent  ?? '–'} color="bg-red-500"     icon={XCircle} />
          <StatCard label="Late"    value={weekAttendance?.late    ?? '–'} color="bg-amber-500"   icon={Clock} />
          <StatCard
            label="Rate"
            value={attendanceRate !== null ? `${attendanceRate}%` : '–'}
            sub={`of ${weekAttendance?.total ?? 0} days`}
             color="bg-[#2c7475]"
            icon={CalendarDays}
          />
        </div>
      </section>

      {/* Outstanding balance */}
      {Number(outstandingBalance) > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <CreditCard className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
             <p className="text-amber-800 font-semibold text-sm">Action needed: outstanding fees</p>
            <p className="text-amber-700 text-xs">R{Number(outstandingBalance).toFixed(2)} is currently due. View the Fees tab for details.</p>
          </div>
        </div>
      )}

      <section className="rounded-3xl border border-[#dce7eb] bg-white p-4 shadow-[0_12px_35px_rgba(31,65,83,.07)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#617487]">Upcoming</h2>
          <a href="/parent/calendar" className="text-xs font-semibold text-[#176b73]">View Calendar</a>
        </div>
        {upcoming.length ? <div className="space-y-2">{upcoming.map(event => (
          <a key={event.id} href="/parent/calendar" className="flex min-w-0 items-center gap-3 rounded-xl bg-[#f4f7f5] p-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f1ef]"><CalendarDays className="h-5 w-5 text-[#176b73]" /></div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#19324a]">{event.title}</p><p className="text-xs text-[#617487]">{new Date(event.start_date).toLocaleDateString()}</p></div>
          </a>
        ))}</div> : <p className="text-sm text-[#84929e]">No upcoming calendar events.</p>}
      </section>

      {/* Recent announcements */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Latest Notices</h2>
        {recentAnnouncements?.length > 0 ? (
          <div className="space-y-3">
            {recentAnnouncements.map((a) => (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start gap-3">
                   <div className="p-2 bg-[#e8f1ef] rounded-lg shrink-0 mt-0.5">
                     <Bell className="h-4 w-4 text-[#176b73]" />
                  </div>
                  <div>
                    <p className="text-gray-800 font-semibold text-sm">{a.title}</p>
                    <p className="text-gray-500 text-xs mt-1 leading-relaxed line-clamp-2">{a.content}</p>
                    <p className="text-gray-300 text-xs mt-2">{new Date(a.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
            No recent notices
          </div>
        )}
      </section>
    </div>
  );
};

export default ParentDashboard;
