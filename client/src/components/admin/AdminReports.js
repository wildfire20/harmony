import React from 'react';
import { useQuery } from 'react-query';
import { BarChart3, TrendingUp, Users, BookOpen, Download, Eye } from 'lucide-react';
import { adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const AdminReports = () => {
  // Fetch statistics
  const { data: statsData, isLoading } = useQuery(
    ['admin-statistics'],
    () => adminAPI.getStatistics()
  );

  const stats = statsData?.data || {};

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
        <button className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 flex items-center space-x-2">
          <Download className="h-4 w-4" />
          <span>Export Report</span>
        </button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-blue-100 mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.overview?.total_students || 0}</p>
              <p className="text-blue-100">Total Students</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center">
            <BookOpen className="h-8 w-8 text-green-100 mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.overview?.total_teachers || 0}</p>
              <p className="text-green-100">Total Teachers</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center">
            <BarChart3 className="h-8 w-8 text-yellow-100 mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.overview?.total_classes || 0}</p>
              <p className="text-yellow-100">Total Classes</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center">
            <TrendingUp className="h-8 w-8 text-purple-100 mr-3" />
            <div>
              <p className="text-2xl font-bold">{stats.overview?.total_tasks || 0}</p>
              <p className="text-purple-100">Total Tasks</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Students by Grade */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <BarChart3 className="h-5 w-5 mr-2 text-blue-600" />
              Students by Grade
            </h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {stats.students_by_grade?.map((grade, index) => (
                <div key={grade.grade_name} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-4 h-4 rounded-full bg-gradient-to-r ${
                      index % 4 === 0 ? 'from-blue-400 to-blue-600' :
                      index % 4 === 1 ? 'from-green-400 to-green-600' :
                      index % 4 === 2 ? 'from-yellow-400 to-yellow-600' :
                      'from-purple-400 to-purple-600'
                    }`}></div>
                    <span className="text-sm font-medium text-gray-900">{grade.grade_name}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500">{grade.student_count} students</span>
                    <div className="w-24 bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full bg-gradient-to-r ${
                          index % 4 === 0 ? 'from-blue-400 to-blue-600' :
                          index % 4 === 1 ? 'from-green-400 to-green-600' :
                          index % 4 === 2 ? 'from-yellow-400 to-yellow-600' :
                          'from-purple-400 to-purple-600'
                        }`}
                        style={{ 
                          width: `${Math.max(10, (grade.student_count / Math.max(...(stats.students_by_grade?.map(g => g.student_count) || [1]))) * 100)}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              )) || (
                <p className="text-gray-500 text-center py-4">No grade data available</p>
              )}
            </div>
          </div>
        </div>

        {/* Activity Summary */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <TrendingUp className="h-5 w-5 mr-2 text-green-600" />
              System Activity
            </h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <span className="text-sm font-medium text-blue-900">Total Submissions</span>
                <span className="text-lg font-bold text-blue-700">{stats.overview?.total_submissions || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="text-sm font-medium text-green-900">Total Announcements</span>
                <span className="text-lg font-bold text-green-700">{stats.overview?.total_announcements || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <span className="text-sm font-medium text-yellow-900">Active Users</span>
                <span className="text-lg font-bold text-yellow-700">
                  {(stats.overview?.total_students || 0) + (stats.overview?.total_teachers || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                <span className="text-sm font-medium text-purple-900">Total Quizzes</span>
                <span className="text-lg font-bold text-purple-700">{stats.overview?.total_quizzes || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Report Actions */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Available Reports</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <h4 className="font-medium text-gray-900 mb-2">Student Report</h4>
              <p className="text-sm text-gray-600 mb-4">
                Complete list of all students with their details and class assignments.
              </p>
              <div className="flex space-x-2">
                <button className="flex-1 bg-blue-600 text-white py-2 px-3 rounded text-sm hover:bg-blue-700 flex items-center justify-center space-x-1">
                  <Eye className="h-4 w-4" />
                  <span>View</span>
                </button>
                <button className="flex-1 border border-gray-300 text-gray-700 py-2 px-3 rounded text-sm hover:bg-gray-50 flex items-center justify-center space-x-1">
                  <Download className="h-4 w-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <h4 className="font-medium text-gray-900 mb-2">Teacher Report</h4>
              <p className="text-sm text-gray-600 mb-4">
                Teacher details, class assignments, and activity summary.
              </p>
              <div className="flex space-x-2">
                <button className="flex-1 bg-green-600 text-white py-2 px-3 rounded text-sm hover:bg-green-700 flex items-center justify-center space-x-1">
                  <Eye className="h-4 w-4" />
                  <span>View</span>
                </button>
                <button className="flex-1 border border-gray-300 text-gray-700 py-2 px-3 rounded text-sm hover:bg-gray-50 flex items-center justify-center space-x-1">
                  <Download className="h-4 w-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <h4 className="font-medium text-gray-900 mb-2">Academic Report</h4>
              <p className="text-sm text-gray-600 mb-4">
                Task submissions, grades, and academic performance overview.
              </p>
              <div className="flex space-x-2">
                <button className="flex-1 bg-purple-600 text-white py-2 px-3 rounded text-sm hover:bg-purple-700 flex items-center justify-center space-x-1">
                  <Eye className="h-4 w-4" />
                  <span>View</span>
                </button>
                <button className="flex-1 border border-gray-300 text-gray-700 py-2 px-3 rounded text-sm hover:bg-gray-50 flex items-center justify-center space-x-1">
                  <Download className="h-4 w-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Quick Statistics</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.overview?.total_students || 0}</p>
              <p className="text-sm text-gray-500">Students Enrolled</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.overview?.total_teachers || 0}</p>
              <p className="text-sm text-gray-500">Teachers Active</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.overview?.total_classes || 0}</p>
              <p className="text-sm text-gray-500">Classes Running</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.overview?.total_tasks || 0}</p>
              <p className="text-sm text-gray-500">Tasks Created</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminReports;
