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

const AdminDashboard = () => {
  const { user } = useAuth();

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
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'normal': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (statsLoading || announcementsLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-green-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
        <h1 className="text-3xl font-bold mb-2">
          Welcome back, {user?.first_name}!
        </h1>
        <p className="text-green-100 mb-4">
          Administrator Dashboard
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-green-100 mr-3" />
              <div>
                <p className="text-2xl font-bold">{stats.overview?.total_students || 0}</p>
                <p className="text-green-100">Students</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <BookOpen className="h-8 w-8 text-blue-100 mr-3" />
              <div>
                <p className="text-2xl font-bold">{stats.overview?.total_teachers || 0}</p>
                <p className="text-green-100">Teachers</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <MessageSquare className="h-8 w-8 text-yellow-100 mr-3" />
              <div>
                <p className="text-2xl font-bold">{stats.overview?.total_tasks || 0}</p>
                <p className="text-green-100">Tasks</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-purple-100 mr-3" />
              <div>
                <p className="text-2xl font-bold">{stats.overview?.total_submissions || 0}</p>
                <p className="text-green-100">Submissions</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Overview */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-green-600" />
                  System Overview
                </h2>
                <Link
                  to="/admin"
                  className="text-green-600 hover:text-green-700 text-sm font-medium"
                >
                  Admin Panel
                </Link>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Students by Grade */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Students by Grade</h3>
                  <div className="space-y-3">
                    {stats.students_by_grade?.map((grade) => (
                      <div key={grade.grade_name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="text-sm font-medium text-gray-900">{grade.grade_name}</span>
                        <span className="text-sm text-gray-500">{grade.student_count} students</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Activity */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">System Statistics</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <span className="text-sm font-medium text-blue-900">Total Classes</span>
                      <span className="text-sm text-blue-700">{stats.overview?.total_classes || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium text-green-900">Total Announcements</span>
                      <span className="text-sm text-green-700">{stats.overview?.total_announcements || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                      <span className="text-sm font-medium text-yellow-900">Active Users</span>
                      <span className="text-sm text-yellow-700">{(stats.overview?.total_students || 0) + (stats.overview?.total_teachers || 0)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                <Link
                  to="/admin"
                  className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Student
                </Link>
                <Link
                  to="/admin"
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Manage System
                </Link>
                <Link
                  to="/announcements"
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Post Announcement
                </Link>
              </div>
            </div>
          </div>

          {/* Recent Announcements */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <MessageSquare className="h-5 w-5 mr-2 text-green-600" />
                  Recent Announcements
                </h2>
                <Link
                  to="/announcements"
                  className="text-green-600 hover:text-green-700 text-sm font-medium"
                >
                  View All
                </Link>
              </div>
            </div>
            <div className="p-6">
              {announcements.length > 0 ? (
                <div className="space-y-4">
                  {announcements.map((announcement) => (
                    <div key={announcement.id} className="border-l-4 border-green-400 pl-4">
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(announcement.priority)}`}>
                          {announcement.priority}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(announcement.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="font-medium text-gray-900 mt-1">{announcement.title}</h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {announcement.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">No announcements yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
