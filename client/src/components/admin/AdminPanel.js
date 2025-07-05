import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Settings, Users, BarChart3 } from 'lucide-react';

const AdminPanel = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Users className="h-8 w-8 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Student Management</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Add, edit, and manage student accounts and class assignments.
          </p>
          <button className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors">
            Manage Students
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Settings className="h-8 w-8 text-green-600" />
            <h2 className="text-xl font-semibold text-gray-900">System Settings</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Configure system settings, grades, and class structures.
          </p>
          <button className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors">
            System Settings
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center space-x-3 mb-4">
            <BarChart3 className="h-8 w-8 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
          </div>
          <p className="text-gray-600 mb-4">
            View system statistics and generate reports.
          </p>
          <button className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 transition-colors">
            View Reports
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
