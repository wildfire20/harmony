import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { 
  BookOpen, 
  MessageSquare, 
  Clock, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Calendar,
  Trophy
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { tasksAPI, announcementsAPI, submissionsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const StudentDashboard = () => {
  const { user } = useAuth();

  // Fetch student's tasks
  const { data: tasksData, isLoading: tasksLoading } = useQuery(
    ['student-tasks', user?.grade_id, user?.class_id],
    () => user?.grade_id && user?.class_id ? tasksAPI.getTasks(user.grade_id, user.class_id) : null,
    { enabled: !!(user?.grade_id && user?.class_id) }
  );

  // Fetch recent announcements
  const { data: announcementsData, isLoading: announcementsLoading } = useQuery(
    ['recent-announcements'],
    () => announcementsAPI.getRecentAnnouncements(5)
  );

  // Fetch student's submissions
  const { data: submissionsData, isLoading: submissionsLoading } = useQuery(
    ['student-submissions'],
    () => submissionsAPI.getStudentSubmissions({ limit: 5 })
  );

  const tasks = tasksData?.data?.tasks || [];
  const announcements = announcementsData?.data?.announcements || [];
  const submissions = submissionsData?.data?.submissions || [];

  const upcomingTasks = tasks
    .filter(task => !task.submission_id && new Date(task.due_date) > new Date())
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 5);

  const overdueTasks = tasks
    .filter(task => !task.submission_id && new Date(task.due_date) <= new Date())
    .slice(0, 5);

  const completedTasks = tasks.filter(task => task.submission_id);

  const getStatusColor = (status) => {
    switch (status) {
      case 'submitted': return 'bg-blue-100 text-blue-800';
      case 'graded': return 'bg-green-100 text-green-800';
      case 'returned': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'normal': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (tasksLoading || announcementsLoading || submissionsLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-pink-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
        <h1 className="text-3xl font-bold mb-2">
          Welcome back, {user?.first_name}!
        </h1>
        <p className="text-pink-100 mb-4">
          {user?.grade_name} - {user?.class_name}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <BookOpen className="h-8 w-8 text-pink-100 mr-3" />
              <div>
                <p className="text-2xl font-bold">{tasks.length}</p>
                <p className="text-pink-100">Total Tasks</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <CheckCircle className="h-8 w-8 text-green-200 mr-3" />
              <div>
                <p className="text-2xl font-bold">{completedTasks.length}</p>
                <p className="text-pink-100">Completed</p>
              </div>
            </div>
          </div>
          <div className="bg-white bg-opacity-20 rounded-lg p-4">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-yellow-200 mr-3" />
              <div>
                <p className="text-2xl font-bold">{upcomingTasks.length}</p>
                <p className="text-pink-100">Upcoming</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Tasks */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                  <Calendar className="h-5 w-5 mr-2 text-pink-600" />
                  Upcoming Tasks
                </h2>
                <Link
                  to="/tasks"
                  className="text-pink-600 hover:text-pink-700 text-sm font-medium"
                >
                  View All
                </Link>
              </div>
            </div>
            <div className="p-6">
              {upcomingTasks.length > 0 ? (
                <div className="space-y-4">
                  {upcomingTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{task.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          Due: {new Date(task.due_date).toLocaleDateString()}
                        </p>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-2 ${
                          task.task_type === 'quiz' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {task.task_type === 'quiz' ? 'Quiz' : 'Assignment'}
                        </span>
                      </div>
                      <Link
                        to={`/tasks/${task.id}`}
                        className="ml-4 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-pink-600 hover:bg-pink-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pink-500"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">All caught up!</h3>
                  <p className="mt-1 text-sm text-gray-500">No upcoming tasks at the moment.</p>
                </div>
              )}
            </div>
          </div>

          {/* Overdue Tasks */}
          {overdueTasks.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-red-200 mt-6">
              <div className="p-6 border-b border-red-200">
                <h2 className="text-xl font-semibold text-red-900 flex items-center">
                  <AlertCircle className="h-5 w-5 mr-2 text-red-600" />
                  Overdue Tasks
                </h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {overdueTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-200"
                    >
                      <div className="flex-1">
                        <h3 className="font-medium text-red-900">{task.title}</h3>
                        <p className="text-sm text-red-700 mt-1">
                          Due: {new Date(task.due_date).toLocaleDateString()}
                        </p>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-2 ${
                          task.task_type === 'quiz' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {task.task_type === 'quiz' ? 'Quiz' : 'Assignment'}
                        </span>
                      </div>
                      <Link
                        to={`/tasks/${task.id}`}
                        className="ml-4 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recent Announcements */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <MessageSquare className="h-5 w-5 mr-2 text-blue-600" />
                  Announcements
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

          {/* Recent Submissions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Trophy className="h-5 w-5 mr-2 text-yellow-600" />
                Recent Submissions
              </h2>
            </div>
            <div className="p-6">
              {submissions.length > 0 ? (
                <div className="space-y-4">
                  {submissions.map((submission) => (
                    <div key={submission.id} className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 text-sm">{submission.title}</h3>
                        <div className="flex items-center mt-1">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(submission.status)}`}>
                            {submission.status}
                          </span>
                          {submission.score !== null && (
                            <span className="ml-2 text-xs text-gray-500">
                              {submission.score}/{submission.max_score}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">No submissions yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
