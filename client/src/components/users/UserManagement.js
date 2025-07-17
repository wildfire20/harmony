import React from 'react';
import { Users, Plus, Filter, UserPlus } from 'lucide-react';

const UserManagement = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Users className="h-8 w-8 text-harmony-secondary" />
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
        </div>
        <div className="flex space-x-3">
          <button className="bg-harmony-navy text-white px-4 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2">
            <Filter className="h-4 w-4" />
            <span>Filter</span>
          </button>
          <button className="bg-harmony-secondary text-white px-4 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2">
            <UserPlus className="h-4 w-4" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center py-12">
          <Users className="mx-auto h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">User Management Available in Admin Panel</h3>
          <p className="text-gray-600 mb-6">
            For now, user management features are available in the Admin Panel. 
            A dedicated user management page is coming soon.
          </p>
          <button 
            onClick={() => window.location.href = '/admin'}
            className="bg-harmony-navy text-white px-6 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2 mx-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Go to Admin Panel</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
