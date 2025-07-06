import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { tasksAPI, submissionsAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const DebugPage = () => {
  const { user } = useAuth();
  const [selectedTaskId, setSelectedTaskId] = useState('');

  // Get all tasks
  const { data: tasksData } = useQuery(
    ['allTasks'],
    () => tasksAPI.getAllTasks(),
    { 
      onSuccess: (data) => {
        console.log('All tasks:', data);
      }
    }
  );

  // Get debug data for selected task
  const { data: debugData, refetch: refetchDebug } = useQuery(
    ['taskDebug', selectedTaskId],
    () => fetch(`/api/submissions/debug/task/${selectedTaskId}/data`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    }).then(res => res.json()),
    { 
      enabled: !!selectedTaskId,
      onSuccess: (data) => {
        console.log('Debug data:', data);
      }
    }
  );

  const tasks = tasksData?.data?.tasks || [];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Debug Page</h1>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">User Info</h2>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto">
              {JSON.stringify(user, null, 2)}
            </pre>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Available Tasks</h2>
            <div className="space-y-2">
              {tasks.map(task => (
                <div key={task.id} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <span className="font-medium">{task.title}</span>
                    <span className="text-sm text-gray-500 ml-2">
                      (ID: {task.id}, Grade: {task.grade_name}, Class: {task.class_name})
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedTaskId(task.id)}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                  >
                    Debug
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {selectedTaskId && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Debug Data for Task {selectedTaskId}</h2>
              <button
                onClick={() => refetchDebug()}
                className="mb-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Refresh Debug Data
              </button>
              <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
                {JSON.stringify(debugData, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DebugPage;
