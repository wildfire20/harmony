import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { BarChart3, TrendingUp, Users, BookOpen, Download } from 'lucide-react';
import { adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const AdminReports = () => {
  const [generatingReport, setGeneratingReport] = useState(null);

  // Fetch statistics
  const { data: statsData, isLoading } = useQuery(
    ['admin-statistics'],
    () => adminAPI.getStatistics()
  );

  const stats = statsData?.data || {};

  // Report generation functions
  const generateStudentReport = async () => {
    try {
      setGeneratingReport('student');
      const response = await adminAPI.getStudents({});
      const students = response.data.students;
      
      // Create CSV content
      const csvContent = [
        ['Student Number', 'First Name', 'Last Name', 'Grade', 'Class', 'Status'].join(','),
        ...students.map(student => [
          student.student_number,
          student.first_name,
          student.last_name,
          student.grade_name || 'Not assigned',
          student.class_name || 'Not assigned',
          student.is_active ? 'Active' : 'Inactive'
        ].join(','))
      ].join('\n');
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `student-report-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast.success('Student report downloaded successfully!');
    } catch (error) {
      console.error('Error generating student report:', error);
      toast.error('Failed to generate student report');
    } finally {
      setGeneratingReport(null);
    }
  };

  const generateTeacherReport = async () => {
    try {
      setGeneratingReport('teacher');
      const response = await adminAPI.getTeachers({});
      const teachers = response.data.teachers;
      
      // Create CSV content
      const csvContent = [
        ['Employee ID', 'First Name', 'Last Name', 'Email', 'Department', 'Status'].join(','),
        ...teachers.map(teacher => [
          teacher.employee_id || 'N/A',
          teacher.first_name,
          teacher.last_name,
          teacher.email,
          teacher.department || 'N/A',
          teacher.is_active ? 'Active' : 'Inactive'
        ].join(','))
      ].join('\n');
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teacher-report-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast.success('Teacher report downloaded successfully!');
    } catch (error) {
      console.error('Error generating teacher report:', error);
      toast.error('Failed to generate teacher report');
    } finally {
      setGeneratingReport(null);
    }
  };

  const generateAcademicReport = async () => {
    try {
      setGeneratingReport('academic');
      // This would ideally fetch task/quiz data and generate academic performance report
      const studentsResponse = await adminAPI.getStudents({});
      const students = studentsResponse.data.students;
      
      // Create a basic academic report
      const csvContent = [
        ['Student Number', 'Student Name', 'Grade', 'Class', 'Enrollment Date'].join(','),
        ...students.map(student => [
          student.student_number,
          `${student.first_name} ${student.last_name}`,
          student.grade_name || 'Not assigned',
          student.class_name || 'Not assigned',
          student.created_at ? new Date(student.created_at).toLocaleDateString() : 'N/A'
        ].join(','))
      ].join('\n');
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `academic-report-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast.success('Academic report downloaded successfully!');
    } catch (error) {
      console.error('Error generating academic report:', error);
      toast.error('Failed to generate academic report');
    } finally {
      setGeneratingReport(null);
    }
  };

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
              <div className="flex justify-center">
                <button 
                  onClick={generateStudentReport}
                  disabled={generatingReport === 'student'}
                  className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg text-sm hover:bg-blue-700 flex items-center justify-center space-x-2 disabled:opacity-50 font-medium"
                >
                  <Download className="h-4 w-4" />
                  <span>{generatingReport === 'student' ? 'Generating Report...' : 'Download Report'}</span>
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <h4 className="font-medium text-gray-900 mb-2">Teacher Report</h4>
              <p className="text-sm text-gray-600 mb-4">
                Teacher details, class assignments, and activity summary.
              </p>
              <div className="flex justify-center">
                <button 
                  onClick={generateTeacherReport}
                  disabled={generatingReport === 'teacher'}
                  className="w-full bg-green-600 text-white py-3 px-4 rounded-lg text-sm hover:bg-green-700 flex items-center justify-center space-x-2 disabled:opacity-50 font-medium"
                >
                  <Download className="h-4 w-4" />
                  <span>{generatingReport === 'teacher' ? 'Generating Report...' : 'Download Report'}</span>
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <h4 className="font-medium text-gray-900 mb-2">Academic Report</h4>
              <p className="text-sm text-gray-600 mb-4">
                Task submissions, grades, and academic performance overview.
              </p>
              <div className="flex justify-center">
                <button 
                  onClick={generateAcademicReport}
                  disabled={generatingReport === 'academic'}
                  className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg text-sm hover:bg-purple-700 flex items-center justify-center space-x-2 disabled:opacity-50 font-medium"
                >
                  <Download className="h-4 w-4" />
                  <span>{generatingReport === 'academic' ? 'Generating Report...' : 'Download Report'}</span>
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
