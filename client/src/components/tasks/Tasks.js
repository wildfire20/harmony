import React from 'react';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { tasksAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const Tasks = () => {
  const { user } = useAuth();

  const { data: tasksData, isLoading } = useQuery(
    ['tasks', user?.grade_id, user?.class_id],
    () => user?.grade_id && user?.class_id ? tasksAPI.getTasks(user.grade_id, user.class_id) : null,
    { enabled: !!(user?.grade_id && user?.class_id) }
  );

  const tasks = tasksData?.data?.tasks || [];

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Tasks & Assignments</h1>
      </div>

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
          </div>
        )}
      </div>
    </div>
  );
};

export default Tasks;
