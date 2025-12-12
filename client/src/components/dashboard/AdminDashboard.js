import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { 
  Bell, 
  ClipboardList, 
  Award,
  ChevronRight,
  CheckCircle
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

  const { data: tasksData, isLoading: tasksLoading } = useQuery(
    ['pending-tasks'],
    () => tasksAPI.getAll(),
    { retry: false }
  );

  const stats = statsData?.data || {};
  const announcements = announcementsData?.data?.announcements || [];
  const tasks = tasksData?.data?.tasks || [];
  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'active');

  if (statsLoading || announcementsLoading) {
    return <LoadingSpinner />;
  }

  const cardBg = theme === 'dark' ? 'bg-gray-700' : 'bg-white';
  const cardBorder = theme === 'dark' ? 'border-gray-600' : 'border-gray-200';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const textMuted = theme === 'dark' ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className={`text-3xl font-bold ${textPrimary}`}>
          Welcome back, {user?.first_name}!
        </h1>
        <p className={`mt-1 ${textSecondary}`}>
          Manage your school from your admin dashboard.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Announcements Card */}
        <div className={`${cardBg} rounded-xl border ${cardBorder} p-6`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-medium ${textSecondary}`}>Announcements</p>
              <p className={`text-3xl font-bold mt-2 ${textPrimary}`}>
                {stats.overview?.total_announcements || announcements.length || 0}
              </p>
              <p className={`text-sm ${textMuted} mt-1`}>
                {announcements.length > 0 ? `${announcements.length} new this week` : 'No new this week'}
              </p>
            </div>
            <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-600' : 'bg-gray-100'}`}>
              <Bell className={`h-6 w-6 ${textMuted}`} />
            </div>
          </div>
        </div>

        {/* Pending Assignments Card */}
        <div className={`${cardBg} rounded-xl border ${cardBorder} p-6`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-medium ${textSecondary}`}>Pending Assignments</p>
              <p className={`text-3xl font-bold mt-2 ${textPrimary}`}>
                {pendingTasks.length}
              </p>
              <p className={`text-sm ${textMuted} mt-1`}>Due this week</p>
            </div>
            <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-600' : 'bg-gray-100'}`}>
              <ClipboardList className={`h-6 w-6 ${textMuted}`} />
            </div>
          </div>
        </div>

        {/* Available Quizzes Card */}
        <div className={`${cardBg} rounded-xl border ${cardBorder} p-6`}>
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-sm font-medium ${textSecondary}`}>Available Quizzes</p>
              <p className={`text-3xl font-bold mt-2 ${textPrimary}`}>
                {stats.overview?.total_quizzes || 1}
              </p>
              <p className={`text-sm ${textMuted} mt-1`}>Ready to take</p>
            </div>
            <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-600' : 'bg-gray-100'}`}>
              <Award className={`h-6 w-6 ${textMuted}`} />
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Announcements */}
        <div className={`${cardBg} rounded-xl border ${cardBorder}`}>
          <div className="flex items-center justify-between p-6 border-b ${cardBorder}">
            <div>
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Recent Announcements</h2>
              <p className={`text-sm ${textMuted}`}>Stay updated with school news</p>
            </div>
            <Link
              to="/announcements"
              className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              View All
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
          <div className="p-6">
            {announcements.length > 0 ? (
              <div className="space-y-4">
                {announcements.slice(0, 3).map((announcement) => (
                  <div key={announcement.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 mt-2 rounded-full bg-red-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${textPrimary} truncate`}>
                          {announcement.title}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex-shrink-0">
                          {announcement.priority || 'class'}
                        </span>
                      </div>
                      <p className={`text-sm ${textMuted} mt-0.5 line-clamp-1`}>
                        {announcement.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Bell className={`h-8 w-8 mx-auto ${textMuted} mb-2`} />
                <p className={textMuted}>No announcements yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Assignments */}
        <div className={`${cardBg} rounded-xl border ${cardBorder}`}>
          <div className="flex items-center justify-between p-6 border-b ${cardBorder}">
            <div>
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Upcoming Assignments</h2>
              <p className={`text-sm ${textMuted}`}>Don't miss your deadlines</p>
            </div>
            <Link
              to="/tasks"
              className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              View All
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
          <div className="p-6">
            {pendingTasks.length > 0 ? (
              <div className="space-y-4">
                {pendingTasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 mt-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className={`font-medium ${textPrimary}`}>{task.title}</span>
                      <p className={`text-sm ${textMuted} mt-0.5`}>
                        Due: {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle className={`h-10 w-10 mx-auto ${textMuted} mb-3`} />
                <p className={textMuted}>No upcoming assignments</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
