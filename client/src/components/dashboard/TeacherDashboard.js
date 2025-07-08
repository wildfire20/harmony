import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { 
  BookOpen, 
  MessageSquare, 
  Users, 
  Clock, 
  CheckCircle,
  Calendar,
  GraduationCap,
  FileText
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { tasksAPI, announcementsAPI, submissionsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const TeacherDashboard = () => {
  const { user } = useAuth();

  // Fetch recent announcements
  const { data: announcementsData, isLoading: announcementsLoading } = useQuery(
    ['recent-announcements'],
    () => announcementsAPI.getRecentAnnouncements(5)
  );

  const announcements = announcementsData?.data?.announcements || [];
  const assignments = user?.assignments || [];

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'normal': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (announcementsLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
        <h1 className="text-3xl font-bold mb-2">
          Welcome back, {user?.first_name}!
        </h1>
        <p className="text-blue-100 mb-4">
          Teacher Dashboard
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <GraduationCap className="h-8 w-8 text-blue-100 mr-3" />
              <div>
                <p className="text-2xl font-bold">{assignments.length}</p>
                <p className="text-blue-100">Classes</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <FileText className="h-8 w-8 text-green-200 mr-3" />
              <div>
                <p className="text-2xl font-bold">0</p>
                <p className="text-blue-100">Pending Grades</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <MessageSquare className="h-8 w-8 text-yellow-200 mr-3" />
              <div>
                <p className="text-2xl font-bold">{announcements.length}</p>
                <p className="text-blue-100">Announcements</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Classes */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                  <Users className="h-5 w-5 mr-2 text-blue-600" />
                  My Classes
                </h2>
                <Link
                  to="/tasks"
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Manage Tasks
                </Link>
              </div>
            </div>
            <div className="p-6">
              {assignments.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {assignments.map((assignment) => (
                    <div
                      key={`${assignment.grade_id}-${assignment.class_id}`}
                      className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/tasks?grade=${assignment.grade_id}&class=${assignment.class_id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-gray-900">
                            {assignment.grade_name} - {assignment.class_name}
                          </h3>
                          <p className="text-sm text-gray-500 mt-1">
                            Click to view tasks and assignments
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-500">
                            <BookOpen className="h-4 w-4 inline mr-1" />
                            Tasks
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <GraduationCap className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No classes assigned</h3>
                  <p className="mt-1 text-sm text-gray-500">Contact admin to get class assignments.</p>
                </div>
              )}
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
                  to="/tasks"
                  className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Create Task
                </Link>
                <Link
                  to="/announcements"
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
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
                  <MessageSquare className="h-5 w-5 mr-2 text-blue-600" />
                  Recent Announcements
                </h2>
                <Link
                  to="/announcements"
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  View All
                </Link>
              </div>
            </div>
            <div className="p-6">
              {announcements.length > 0 ? (
                <div className="space-y-4">
                  {announcements.map((announcement) => (
                    <div key={announcement.id} className="border-l-4 border-blue-400 pl-4">
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

export default TeacherDashboard;
