import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, CheckCircle, AlertTriangle, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { tasksAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const Tasks = () => {
  const { user } = useAuth();

  console.log('=== TASKS COMPONENT DEBUG ===');
  console.log('User:', user);
  console.log('User grade_id:', user?.grade_id);
  console.log('User class_id:', user?.class_id);
  console.log('User role:', user?.role);

  const { data: tasksData, isLoading, error } = useQuery(
    ['tasks', user?.grade_id, user?.class_id],
    async () => {
      if (!user?.grade_id || !user?.class_id) {
        console.warn('Missing grade_id or class_id for user:', user);
        throw new Error('Your account is missing grade or class assignment. Please contact the administrator.');
      }
      
      console.log('Fetching tasks for grade:', user.grade_id, 'class:', user.class_id);
      
      try {
        const response = await tasksAPI.getTasks(user.grade_id, user.class_id);
        console.log('Tasks API response:', response);
        return response;
      } catch (apiError) {
        console.error('Tasks API error:', apiError);
        console.error('Error response:', apiError.response?.data);
        throw apiError;
      }
    },
    { 
      enabled: !!(user?.grade_id && user?.class_id),
      retry: (failureCount, error) => {
        console.log('Task fetch retry attempt:', failureCount, 'Error:', error.message);
        // Don't retry for auth/permission errors
        if (error.message.includes('403') || error.message.includes('401')) {
          return false;
        }
        return failureCount < 2;
      }
    }
  );

  const tasks = tasksData?.data?.tasks || [];

  console.log('Final tasks data:', tasks);
  console.log('Tasks count:', tasks.length);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    console.error('Tasks component error:', error);
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Tasks & Assignments</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
            <h3 className="text-lg font-medium text-red-800">Error Loading Tasks</h3>
          </div>
          <p className="mt-2 text-red-700">
            {error.message || 'Failed to load tasks. Please try again or contact support.'}
          </p>
          {user?.role === 'student' && (!user?.grade_id || !user?.class_id) && (
            <p className="mt-2 text-red-700 text-sm">
              Your account appears to be missing grade or class assignment. Please contact the administrator.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Tasks & Assignments</h1>
        {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
          <Link
            to="/tasks/create"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Task
          </Link>
        )}
      </div>

      {user && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-sm text-blue-700">
            <strong>Viewing tasks for:</strong> {user.grade_name || `Grade ${user.grade_id}`} - {user.class_name || `Class ${user.class_id}`}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <div key={task.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <BookOpen className="h-5 w-5 text-blue-600" />
                    <h2 className="text-xl font-semibold text-gray-900">{task.title}</h2>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      task.task_type === 'quiz' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {task.task_type === 'quiz' ? 'Quiz' : 'Assignment'}
                    </span>
                  </div>
                  <p className="mt-2 text-gray-600">{task.description}</p>
                  <div className="mt-4 flex items-center space-x-4 text-sm text-gray-500">
                    <div className="flex items-center">
                      <Clock className="h-4 w-4 mr-1" />
                      Due: {new Date(task.due_date).toLocaleDateString()}
                    </div>
                    <div>Max Points: {task.max_points}</div>
                    <div>Teacher: {task.teacher_first_name} {task.teacher_last_name}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {task.submission_id ? (
                    <span className="flex items-center text-green-600">
                      <CheckCircle className="h-5 w-5 mr-1" />
                      Submitted
                    </span>
                  ) : new Date(task.due_date) <= new Date() ? (
                    <span className="flex items-center text-red-600">
                      <AlertTriangle className="h-5 w-5 mr-1" />
                      Overdue
                    </span>
                  ) : (
                    <span className="flex items-center text-yellow-600">
                      <Clock className="h-5 w-5 mr-1" />
                      Pending
                    </span>
                  )}
                  <Link
                    to={`/tasks/${task.id}`}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-12">
            <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No tasks found</h3>
            <p className="mt-1 text-sm text-gray-500">
              There are no tasks assigned to your class yet.
            </p>
            {user?.role === 'student' && (
              <p className="mt-2 text-xs text-gray-400">
                Your grade: {user.grade_name || user.grade_id} | Your class: {user.class_name || user.class_id}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Tasks;
