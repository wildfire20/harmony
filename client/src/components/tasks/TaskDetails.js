import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from 'react-query';
import { tasksAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const TaskDetails = () => {
  const { id } = useParams();
  
  const { data: taskData, isLoading } = useQuery(
    ['task', id],
    () => tasksAPI.getTask(id),
    { enabled: !!id }
  );

  const task = taskData?.data?.task;

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!task) {
    return <div>Task not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{task.title}</h1>
        <div className="prose max-w-none">
          <p className="text-gray-600 mb-4">{task.description}</p>
          {task.instructions && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Instructions</h3>
              <p className="text-gray-600">{task.instructions}</p>
            </div>
          )}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Due: {new Date(task.due_date).toLocaleDateString()} | Max Points: {task.max_points}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskDetails;
