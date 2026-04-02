import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import {
  CheckCircle, XCircle, Clock, BookOpen, Bell,
  TrendingUp, AlertCircle, CreditCard, CalendarDays
} from 'lucide-react';

const StatCard = ({ label, value, sub, color, icon: Icon }) => (
  <div className={`rounded-2xl p-4 flex items-center gap-4 ${color}`}>
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

  useEffect(() => {
    parentApi('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
      <AlertCircle className="h-5 w-5 shrink-0" />
      {error}
    </div>
  );

  const { weekAttendance, recentGrades, outstandingBalance, recentAnnouncements } = data || {};

  const attendanceRate = weekAttendance?.total > 0
    ? Math.round((parseInt(weekAttendance.present) / parseInt(weekAttendance.total)) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Good day, {user?.first_name} 👋</h1>
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
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">This Week's Attendance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Present" value={weekAttendance?.present ?? '–'} color="bg-emerald-500" icon={CheckCircle} />
          <StatCard label="Absent"  value={weekAttendance?.absent  ?? '–'} color="bg-red-500"     icon={XCircle} />
          <StatCard label="Late"    value={weekAttendance?.late    ?? '–'} color="bg-amber-500"   icon={Clock} />
          <StatCard
            label="Rate"
            value={attendanceRate !== null ? `${attendanceRate}%` : '–'}
            sub={`of ${weekAttendance?.total ?? 0} days`}
            color="bg-blue-600"
            icon={CalendarDays}
          />
        </div>
      </section>

      {/* Outstanding balance */}
      {outstandingBalance > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <CreditCard className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <p className="text-amber-800 font-semibold text-sm">Outstanding fees</p>
            <p className="text-amber-700 text-xs">R{Number(outstandingBalance).toFixed(2)} is currently due. View the Fees tab for details.</p>
          </div>
        </div>
      )}

      {/* Recent grades */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Grades</h2>
        {recentGrades?.length > 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {recentGrades.map((g) => {
              const pct = g.max_score > 0 ? Math.round((g.score / g.max_score) * 100) : null;
              const color = pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
              return (
                <div key={g.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                      <BookOpen className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-gray-800 font-medium text-sm truncate">{g.task_title}</p>
                      <p className="text-gray-400 text-xs capitalize">{g.task_type}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {g.score !== null ? (
                      <>
                        <p className={`font-bold text-sm ${color}`}>{g.score}/{g.max_score}</p>
                        {pct !== null && <p className="text-gray-400 text-xs">{pct}%</p>}
                      </>
                    ) : (
                      <span className="text-gray-400 text-xs">Pending</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-gray-400 text-sm">
            No graded work yet
          </div>
        )}
      </section>

      {/* Recent announcements */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Latest Notices</h2>
        {recentAnnouncements?.length > 0 ? (
          <div className="space-y-3">
            {recentAnnouncements.map((a) => (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg shrink-0 mt-0.5">
                    <Bell className="h-4 w-4 text-blue-600" />
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
