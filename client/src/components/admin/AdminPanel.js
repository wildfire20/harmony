import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Settings, Users, BarChart3, Plus, UserPlus, GraduationCap } from 'lucide-react';
import StudentManagement from './StudentManagement';
import TeacherManagement from './TeacherManagement';
import SystemSettings from './SystemSettings';
import AdminReports from './AdminReports';

const AdminPanel = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', name: 'Overview', icon: BarChart3 },
    { id: 'students', name: 'Student Management', icon: GraduationCap },
    { id: 'teachers', name: 'Teacher Management', icon: Users },
    { id: 'settings', name: 'System Settings', icon: Settings },
    { id: 'reports', name: 'Reports', icon: BarChart3 },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'students':
        return <StudentManagement />;
      case 'teachers':
        return <TeacherManagement />;
      case 'settings':
        return <SystemSettings />;
      case 'reports':
        return <AdminReports />;
      default:
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <GraduationCap className="h-8 w-8 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900">Student Management</h2>
              </div>
              <p className="text-gray-600 mb-4">
                Add, edit, and manage student accounts and class assignments.
              </p>
              <button 
                onClick={() => setActiveTab('students')}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
              >
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
              <button 
                onClick={() => setActiveTab('settings')}
                className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors"
              >
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
              <button 
                onClick={() => setActiveTab('reports')}
                className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 transition-colors"
              >
                View Reports
              </button>
            </div>

            {/* Debug Panel */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Settings className="h-8 w-8 text-orange-600" />
                <h2 className="text-xl font-semibold text-gray-900">Debug Tools</h2>
              </div>
              <p className="text-gray-600 mb-4">
                Debug document visibility and student assignments.
              </p>
              <div className="space-y-3">
                <button 
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/admin/debug-documents', {
                        headers: {
                          'Authorization': `Bearer ${localStorage.getItem('token')}`
                        }
                      });
                      const data = await response.json();
                      console.log('=== DEBUG DATA ===');
                      console.log('Documents:', data.documents);
                      console.log('Students:', data.students);
                      console.log('Summary:', data.summary);
                      console.log('=== END DEBUG ===');
                      alert('Debug data logged to console. Check browser developer tools.');
                    } catch (error) {
                      console.error('Debug error:', error);
                      alert('Debug failed. Check console for errors.');
                    }
                  }}
                  className="w-full bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 transition-colors"
                >
                  Debug Documents
                </button>
                
                <button 
                  onClick={async () => {
                    if (window.confirm('This will redistribute the latest document to ALL grade/class combinations. Continue?')) {
                      try {
                        const response = await fetch('/api/admin/redistribute-documents', {
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                          }
                        });
                        const data = await response.json();
                        alert(data.message);
                      } catch (error) {
                        console.error('Redistribute error:', error);
                        alert('Redistribution failed. Check console for errors.');
                      }
                    }
                  }}
                  className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors"
                >
                  Redistribute Last Document
                </button>
                
                <button 
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/documents/create-test-document', {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${localStorage.getItem('token')}`
                        }
                      });
                      const data = await response.json();
                      alert(data.message);
                    } catch (error) {
                      console.error('Create test document error:', error);
                      alert('Failed to create test document. Check console for errors.');
                    }
                  }}
                  className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors"
                >
                  Create Test Document
                </button>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-gray-600">Welcome, {user?.first_name}</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {renderTabContent()}
      </div>
    </div>
  );
};

export default AdminPanel;
