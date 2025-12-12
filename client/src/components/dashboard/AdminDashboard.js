import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { 
  Bell, 
  ClipboardList, 
  Award,
  ChevronRight,
  CheckCircle,
  Users,
  BookOpen,
  TrendingUp,
  MessageSquare,
  Settings,
  UserPlus,
  BarChart3
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { adminAPI, announcementsAPI, tasksAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import { useTheme } from '../common/ThemeProvider';

const AdminDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();

  const { data: statsData, isLoading: statsLoading } = useQuery(
    ['admin-statistics'],
    () => adminAPI.getStatistics()
  );

  const { data: announcementsData, isLoading: announcementsLoading } = useQuery(
    ['recent-announcements'],
    () => announcementsAPI.getRecentAnnouncements(5)
  );

  const { data: tasksData } = useQuery(
    ['pending-tasks'],
    () => tasksAPI.getAll(),
    { retry: false }
  );

  const stats = statsData?.data || {};
  const announcements = announcementsData?.data?.announcements || [];
  const tasks = tasksData?.data?.tasks || [];
  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'active');

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-700';
      case 'high': return 'bg-amber-100 text-amber-700';
      case 'normal': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  if (statsLoading || announcementsLoading) {
    return <LoadingSpinner />;
  }

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';
  const textMuted = isDark ? 'text-gray-500' : 'text-gray-400';
  const iconBg = isDark ? 'bg-gray-800' : 'bg-gray-50';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className={`text-3xl font-bold tracking-tight ${textPrimary}`}>
          Welcome back, {user?.first_name}!
        </h1>
        <p className={`mt-2 ${textSecondary}`}>
          Manage your school from your admin dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className={`${cardBg} rounded-2xl border ${cardBorder} p-6 shadow-sm hover:shadow-md transition-shadow duration-300`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-medium ${textSecondary}`}>Announcements</p>
              <p className={`text-4xl font-bold mt-3 ${textPrimary}`}>
                {stats.overview?.total_announcements || announcements.length || 0}
              </p>
              <p className={`text-sm ${textMuted} mt-2`}>
                {announcements.length > 0 ? `${announcements.length} new this week` : 'No new this week'}
              </p>
            </div>
            <div className={`p-3 rounded-xl ${iconBg}`}>
              <Bell className={`h-6 w-6 ${textMuted}`} />
            </div>
          </div>
        </div>

        <div className={`${cardBg} rounded-2xl border ${cardBorder} p-6 shadow-sm hover:shadow-md transition-shadow duration-300`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-medium ${textSecondary}`}>Pending Assignments</p>
              <p className={`text-4xl font-bold mt-3 ${textPrimary}`}>
                {pendingTasks.length}
              </p>
              <p className={`text-sm ${textMuted} mt-2`}>Due this week</p>
            </div>
            <div className={`p-3 rounded-xl ${iconBg}`}>
              <ClipboardList className={`h-6 w-6 ${textMuted}`} />
            </div>
          </div>
        </div>

        <div className={`${cardBg} rounded-2xl border ${cardBorder} p-6 shadow-sm hover:shadow-md transition-shadow duration-300`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-medium ${textSecondary}`}>Available Quizzes</p>
              <p className={`text-4xl font-bold mt-3 ${textPrimary}`}>
                {stats.overview?.total_quizzes || 1}
              </p>
              <p className={`text-sm ${textMuted} mt-2`}>Ready to take</p>
            </div>
            <div className={`p-3 rounded-xl ${iconBg}`}>
              <Award className={`h-6 w-6 ${textMuted}`} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={`${cardBg} rounded-2xl border ${cardBorder} shadow-sm overflow-hidden`}>
          <div className={`flex items-center justify-between p-6 border-b ${cardBorder}`}>
            <div>
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Recent Announcements</h2>
              <p className={`text-sm ${textMuted} mt-0.5`}>Stay updated with school news</p>
            </div>
            <Link
              to="/announcements"
              className={`flex items-center gap-1 text-sm font-medium ${textSecondary} hover:text-red-600 transition-colors`}
            >
              View All
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="p-6">
            {announcements.length > 0 ? (
              <div className="space-y-4">
                {announcements.slice(0, 4).map((announcement) => (
                  <div key={announcement.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 mt-2 rounded-full bg-red-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium ${textPrimary}`}>
                          {announcement.title}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getPriorityColor(announcement.priority)}`}>
                          {announcement.priority || 'class'}
                        </span>
                      </div>
                      <p className={`text-sm ${textMuted} mt-1 line-clamp-1`}>
                        {announcement.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <Bell className={`h-10 w-10 mx-auto ${textMuted} mb-3`} />
                <p className={textMuted}>No announcements yet</p>
              </div>
            )}
          </div>
        </div>

        <div className={`${cardBg} rounded-2xl border ${cardBorder} shadow-sm overflow-hidden`}>
          <div className={`flex items-center justify-between p-6 border-b ${cardBorder}`}>
            <div>
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Upcoming Assignments</h2>
              <p className={`text-sm ${textMuted} mt-0.5`}>Don't miss your deadlines</p>
            </div>
            <Link
              to="/tasks"
              className={`flex items-center gap-1 text-sm font-medium ${textSecondary} hover:text-red-600 transition-colors`}
            >
              View All
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="p-6">
            {pendingTasks.length > 0 ? (
              <div className="space-y-4">
                {pendingTasks.slice(0, 4).map((task) => (
                  <div key={task.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 mt-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className={`font-medium ${textPrimary}`}>{task.title}</span>
                      <p className={`text-sm ${textMuted} mt-1`}>
                        Due: {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date set'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <CheckCircle className={`h-10 w-10 mx-auto ${textMuted} mb-3`} />
                <p className={textMuted}>No upcoming assignments</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`lg:col-span-2 ${cardBg} rounded-2xl border ${cardBorder} shadow-sm overflow-hidden`}>
          <div className={`flex items-center justify-between p-6 border-b ${cardBorder}`}>
            <h2 className={`text-lg font-semibold flex items-center gap-2 ${textPrimary}`}>
              <BarChart3 className="h-5 w-5 text-red-500" />
              System Overview
            </h2>
            <Link
              to="/admin"
              className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
            >
              Admin Panel
            </Link>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className={`text-sm font-semibold ${textSecondary} uppercase tracking-wide mb-4`}>Students by Grade</h3>
                <div className="space-y-3">
                  {stats.students_by_grade?.slice(0, 6).map((grade) => (
                    <div key={grade.grade_name} className={`flex items-center justify-between p-3 rounded-xl ${iconBg}`}>
                      <span className={`text-sm font-medium ${textPrimary}`}>{grade.grade_name}</span>
                      <span className={`text-sm ${textSecondary}`}>{grade.student_count} students</span>
                    </div>
                  ))}
                  {(!stats.students_by_grade || stats.students_by_grade.length === 0) && (
                    <p className={`text-sm ${textMuted}`}>No grade data available</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className={`text-sm font-semibold ${textSecondary} uppercase tracking-wide mb-4`}>System Statistics</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20">
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Classes</span>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{stats.overview?.total_classes || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Total Announcements</span>
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{stats.overview?.total_announcements || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20">
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Active Users</span>
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{(stats.overview?.total_students || 0) + (stats.overview?.total_teachers || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`${cardBg} rounded-2xl border ${cardBorder} shadow-sm overflow-hidden`}>
          <div className={`p-6 border-b ${cardBorder}`}>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Quick Actions</h2>
          </div>
          <div className="p-6 space-y-3">
            <Link
              to="/admin"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/25 transition-all duration-200"
            >
              <UserPlus className="h-4 w-4" />
              Add Student
            </Link>
            <Link
              to="/admin"
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl border ${cardBorder} ${textPrimary} hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
            >
              <Settings className="h-4 w-4" />
              Manage System
            </Link>
            <Link
              to="/announcements"
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl border ${cardBorder} ${textPrimary} hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
            >
              <MessageSquare className="h-4 w-4" />
              Post Announcement
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
