import React, { useState, useEffect } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts';
import { BarChart3, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import LoadingSpinner from '../common/LoadingSpinner';

const Analytics = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState(30);

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/analytics/dashboard?period=${period}`);
      
      if (response.data.success) {
        setAnalytics(response.data.analytics);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

  const StatCard = ({ value, label, color }) => (
    <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-5`}>
      <div className={`text-3xl font-bold mb-1 ${color || textPrimary}`}>{value}</div>
      <div className={`text-sm ${textSecondary}`}>{label}</div>
    </div>
  );

  const ChartCard = ({ title, children }) => (
    <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
      <div className={`p-4 border-b ${cardBorder}`}>
        <h3 className={`font-semibold ${textPrimary}`}>{title}</h3>
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );

  const renderStudentAnalytics = () => {
    if (!analytics || !analytics.submission_stats) return null;

    const submissionData = [
      { name: 'Total', value: analytics.submission_stats.total_submissions || 0 },
      { name: 'Graded', value: analytics.submission_stats.graded_submissions || 0 },
      { name: 'Late', value: analytics.submission_stats.late_submissions || 0 }
    ];

    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard 
            value={analytics.submission_stats.total_submissions || 0} 
            label="Total Submissions" 
            color="text-blue-600"
          />
          <StatCard 
            value={analytics.submission_stats.graded_submissions || 0} 
            label="Graded" 
            color="text-emerald-600"
          />
          <StatCard 
            value={`${analytics.submission_stats.average_score ? Math.round(analytics.submission_stats.average_score) : 0}%`} 
            label="Average Score" 
            color="text-purple-600"
          />
          <StatCard 
            value={analytics.submission_stats.late_submissions || 0} 
            label="Late Submissions" 
            color="text-amber-600"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="Submission Overview">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={submissionData}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
                <XAxis dataKey="name" stroke={isDark ? '#9ca3af' : '#6b7280'} />
                <YAxis stroke={isDark ? '#9ca3af' : '#6b7280'} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: isDark ? '#1f2937' : '#fff',
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    borderRadius: '12px'
                  }}
                />
                <Bar dataKey="value" fill="#10b981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Recent Tasks">
            <div className="space-y-3 max-h-[280px] overflow-y-auto">
              {analytics.recent_tasks && analytics.recent_tasks.length > 0 ? (
                analytics.recent_tasks.map((task, index) => (
                  <div key={index} className={`p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                    <div className={`font-medium ${textPrimary} text-sm`}>{task.title}</div>
                    <div className="flex justify-between items-center mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        task.task_type === 'quiz' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {task.task_type}
                      </span>
                      <span className={`text-sm ${textSecondary}`}>
                        {task.score !== null ? `${task.score}/${task.max_score}` : 'Not submitted'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className={textSecondary}>No recent tasks available</p>
              )}
            </div>
          </ChartCard>
        </div>
      </>
    );
  };

  const renderTeacherAnalytics = () => {
    if (!analytics) return null;

    const taskTypeData = [
      { name: 'Assignments', value: analytics.task_stats?.assignments || 0 },
      { name: 'Quizzes', value: analytics.task_stats?.quizzes || 0 }
    ];

    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard 
            value={analytics.task_stats?.total_tasks || 0} 
            label="Tasks Created" 
            color="text-blue-600"
          />
          <StatCard 
            value={analytics.submission_stats?.total_submissions || 0} 
            label="Student Submissions" 
            color="text-emerald-600"
          />
          <StatCard 
            value={analytics.submission_stats?.pending_grading || 0} 
            label="Pending Grading" 
            color="text-amber-600"
          />
          <StatCard 
            value={analytics.class_stats?.total_students || 0} 
            label="Total Students" 
            color="text-purple-600"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="Task Types Created">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={taskTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {taskTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Class Statistics">
            <div className="space-y-4 py-4">
              <div className={`flex justify-between items-center p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <span className={textSecondary}>Grades Taught</span>
                <span className={`font-semibold ${textPrimary}`}>{analytics.class_stats?.grades_taught || 0}</span>
              </div>
              <div className={`flex justify-between items-center p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <span className={textSecondary}>Classes Taught</span>
                <span className={`font-semibold ${textPrimary}`}>{analytics.class_stats?.classes_taught || 0}</span>
              </div>
              <div className={`flex justify-between items-center p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <span className={textSecondary}>Average Score</span>
                <span className={`font-semibold ${textPrimary}`}>
                  {analytics.submission_stats?.average_score ? Math.round(analytics.submission_stats.average_score) : 0}%
                </span>
              </div>
            </div>
          </ChartCard>
        </div>
      </>
    );
  };

  const renderAdminAnalytics = () => {
    if (!analytics) return null;

    const platformData = [
      { name: 'Students', value: analytics.platform_stats?.total_students || 0 },
      { name: 'Teachers', value: analytics.platform_stats?.total_teachers || 0 },
      { name: 'Admins', value: analytics.platform_stats?.total_admins || 0 }
    ];

    const contentData = [
      { name: 'Total Tasks', value: analytics.content_stats?.total_tasks || 0 },
      { name: 'Assignments', value: analytics.content_stats?.assignments || 0 },
      { name: 'Quizzes', value: analytics.content_stats?.quizzes || 0 }
    ];

    return (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard 
            value={analytics.platform_stats?.total_students || 0} 
            label="Total Students" 
            color="text-blue-600"
          />
          <StatCard 
            value={analytics.platform_stats?.total_teachers || 0} 
            label="Total Teachers" 
            color="text-emerald-600"
          />
          <StatCard 
            value={analytics.content_stats?.total_tasks || 0} 
            label="Total Tasks" 
            color="text-purple-600"
          />
          <StatCard 
            value={analytics.content_stats?.total_submissions || 0} 
            label="Total Submissions" 
            color="text-amber-600"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ChartCard title="Platform Users">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={platformData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Content Statistics">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={contentData}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
                <XAxis dataKey="name" stroke={isDark ? '#9ca3af' : '#6b7280'} />
                <YAxis stroke={isDark ? '#9ca3af' : '#6b7280'} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: isDark ? '#1f2937' : '#fff',
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    borderRadius: '12px'
                  }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="Platform Performance">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-2">
            <div className={`p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'} text-center`}>
              <div className={`text-2xl font-bold text-emerald-600`}>
                {analytics.content_stats?.platform_average_score ? Math.round(analytics.content_stats.platform_average_score) : 0}%
              </div>
              <div className={`text-sm ${textSecondary}`}>Average Score</div>
            </div>
            <div className={`p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'} text-center`}>
              <div className={`text-2xl font-bold text-blue-600`}>{analytics.platform_stats?.total_grades || 0}</div>
              <div className={`text-sm ${textSecondary}`}>Total Grades</div>
            </div>
            <div className={`p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'} text-center`}>
              <div className={`text-2xl font-bold text-purple-600`}>{analytics.platform_stats?.total_classes || 0}</div>
              <div className={`text-sm ${textSecondary}`}>Total Classes</div>
            </div>
            <div className={`p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'} text-center`}>
              <div className={`text-2xl font-bold text-amber-600`}>{analytics.content_stats?.graded_submissions || 0}</div>
              <div className={`text-sm ${textSecondary}`}>Graded</div>
            </div>
          </div>
        </ChartCard>
      </>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/25">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Analytics Dashboard</h1>
        </div>
        <div className={`${cardBg} rounded-2xl shadow-sm border border-red-200 p-6 text-center`}>
          <h3 className="text-lg font-semibold text-red-600 mb-2">Error Loading Analytics</h3>
          <p className={textSecondary}>{error}</p>
          <button 
            onClick={fetchAnalytics}
            className="mt-4 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/25">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Analytics Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={period} 
            onChange={(e) => setPeriod(parseInt(e.target.value))}
            className={`px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button
            onClick={fetchAnalytics}
            className={`p-2.5 rounded-xl border ${cardBorder} ${textSecondary} hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Analytics Content */}
      {user.role === 'student' && renderStudentAnalytics()}
      {user.role === 'teacher' && renderTeacherAnalytics()}
      {(user.role === 'admin' || user.role === 'super_admin') && renderAdminAnalytics()}
    </div>
  );
};

export default Analytics;
