import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { BookOpen, Clock, CheckCircle, AlertCircle, FileText } from 'lucide-react';

const ProgressBar = ({ value, max, color }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
};

const gradeColor = (pct) => {
  if (pct >= 75) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-red-500';
};

const gradeTextColor = (pct) => {
  if (pct >= 75) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-600';
};

const ParentGrades = ({ child }) => {
  const [submissions, setSubmissions] = useState([]);
  const [pendingTasks, setPendingTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('graded');

  useEffect(() => {
    parentApi('/grades')
      .then((d) => {
        setSubmissions(d.submissions || []);
        setPendingTasks(d.pendingTasks || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const graded = submissions.filter((s) => s.score !== null);
  const avgPct = graded.length > 0
    ? Math.round(graded.reduce((acc, s) => acc + (s.max_score > 0 ? (s.score / s.max_score) * 100 : 0), 0) / graded.length)
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Academic Progress</h1>
        {child && (
          <p className="text-gray-500 text-sm mt-1">{child.first_name} {child.last_name} &bull; {child.grade_name}</p>
        )}
      </div>

      {/* Summary card */}
      {graded.length > 0 && (
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-5 text-white">
          <p className="text-blue-200 text-sm font-medium">Average Score</p>
          <p className="text-4xl font-bold mt-1">{avgPct}%</p>
          <p className="text-blue-300 text-xs mt-1">{graded.length} graded assignments</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: 'graded', label: `Graded (${graded.length})` },
          { key: 'pending', label: `Pending (${pendingTasks.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : tab === 'graded' ? (
        graded.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            No graded work yet
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {graded.map((s) => {
              const pct = s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0;
              return (
                <div key={s.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                        <BookOpen className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-gray-800 font-medium text-sm truncate">{s.task_title}</p>
                        <p className="text-gray-400 text-xs capitalize">{s.task_type}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-bold text-lg ${gradeTextColor(pct)}`}>{s.score}/{s.max_score}</p>
                      <div className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-emerald-500" />
                        <span className="text-xs text-gray-400">Graded</span>
                      </div>
                    </div>
                  </div>
                  <ProgressBar value={s.score} max={s.max_score} color={gradeColor(pct)} />
                  {s.feedback && (
                    <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-2 italic">"{s.feedback}"</p>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        pendingTasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            No pending assignments
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {pendingTasks.map((t) => {
              const isOverdue = t.due_date && new Date(t.due_date) < new Date();
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`p-2 rounded-lg shrink-0 ${isOverdue ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <FileText className={`h-4 w-4 ${isOverdue ? 'text-red-500' : 'text-amber-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 font-medium text-sm truncate">{t.title}</p>
                    <p className="text-gray-400 text-xs capitalize">{t.task_type} &bull; {t.max_score} marks</p>
                  </div>
                  {t.due_date && (
                    <div className={`flex items-center gap-1 text-xs shrink-0 ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                      <Clock className="h-3 w-3" />
                      {new Date(t.due_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};

export default ParentGrades;
