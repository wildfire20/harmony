import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { 
  Users, 
  BookOpen, 
  MessageSquare, 
  Settings,
  TrendingUp,
  Calendar,
  UserPlus,
  BarChart3
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { adminAPI, announcementsAPI } from '../../services/api';
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

  const stats = statsData?.data || {};
  const announcements = announcementsData?.data?.announcements || [];

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

  return (
    <div className="space-y-6">
      {/* Welcome Section - Same structure, modernized */}
      <div className="bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-600 rounded-2xl shadow-xl p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px'}}></div>
        <div className="relative">
          <h1 className="text-3xl font-bold mb-1">
            Welcome back, {user?.first_name}!
          </h1>
          <p className="text-white/80 text-sm">
            Administrator Dashboard
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overview?.total_students || 0}</p>
                  <p className="text-white/70 text-sm">Students</p>
                </div>
              </div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overview?.total_teachers || 0}</p>
                  <p className="text-white/70 text-sm">Teachers</p>
                </div>
              </div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <MessageSquare className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overview?.total_tasks || 0}</p>
                  <p className="text-white/70 text-sm">Tasks</p>
                </div>
              </div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overview?.total_submissions || 0}</p>
                  <p className="text-white/70 text-sm">Submissions</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Overview - Same structure, modernized */}
        <div className="lg:col-span-2">
          <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
            <div className={`p-5 border-b ${cardBorder} flex items-center justify-between`}>
              <h2 className={`text-lg font-semibold ${textPrimary} flex items-center gap-2`}>
                <BarChart3 className="h-5 w-5 text-emerald-500" />
                System Overview
              </h2>
              <Link
                to="/admin"
                className="text-emerald-600 hover:text-emerald-700 text-sm font-medium transition-colors"
              >
                Admin Panel
              </Link>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Students by Grade - Same feature */}
                <div>
                  <h3 className={`text-sm font-semibold ${textSecondary} uppercase tracking-wide mb-4`}>Students by Grade</h3>
                  <div className="space-y-2">
                    {stats.students_by_grade?.map((grade) => (
                      <div key={grade.grade_name} className={`flex items-center justify-between p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'} hover:shadow-sm transition-shadow`}>
                        <span className={`text-sm font-medium ${textPrimary}`}>{grade.grade_name}</span>
                        <span className={`text-sm ${textSecondary}`}>{grade.student_count} students</span>
                      </div>
                    ))}
                    {(!stats.students_by_grade || stats.students_by_grade.length === 0) && (
                      <p className={`text-sm ${textSecondary}`}>No grade data available</p>
                    )}
                  </div>
                </div>

                {/* System Statistics - Same feature */}
                <div>
                  <h3 className={`text-sm font-semibold ${textSecondary} uppercase tracking-wide mb-4`}>System Statistics</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50 dark:bg-blue-900/30">
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Classes</span>
                      <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{stats.overview?.total_classes || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/30">
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Total Announcements</span>
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{stats.overview?.total_announcements || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-900/30">
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Active Users</span>
                      <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{(stats.overview?.total_students || 0) + (stats.overview?.total_teachers || 0)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - Same features */}
        <div className="space-y-6">
          {/* Quick Actions - Same buttons */}
          <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
            <div className={`p-5 border-b ${cardBorder}`}>
              <h2 className={`text-lg font-semibold ${textPrimary}`}>Quick Actions</h2>
            </div>
            <div className="p-5 space-y-3">
              <Link
                to="/admin"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/25 transition-all"
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

          {/* Recent Announcements - Same feature */}
          <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
            <div className={`p-5 border-b ${cardBorder} flex items-center justify-between`}>
              <h2 className={`text-lg font-semibold ${textPrimary} flex items-center gap-2`}>
                <MessageSquare className="h-5 w-5 text-emerald-500" />
                Recent Announcements
              </h2>
              <Link
                to="/announcements"
                className="text-emerald-600 hover:text-emerald-700 text-sm font-medium transition-colors"
              >
                View All
              </Link>
            </div>
            <div className="p-5">
              {announcements.length > 0 ? (
                <div className="space-y-4">
                  {announcements.map((announcement) => (
                    <div key={announcement.id} className={`border-l-4 border-emerald-400 pl-4 py-1`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(announcement.priority)}`}>
                          {announcement.priority}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(announcement.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className={`font-medium ${textPrimary} text-sm`}>{announcement.title}</h3>
                      <p className={`text-sm ${textSecondary} mt-1 line-clamp-2`}>
                        {announcement.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`${textSecondary} text-center py-6`}>No announcements yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
