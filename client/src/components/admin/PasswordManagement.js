import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { passwordsAPI, adminAPI } from '../../services/api';
import { Key, RefreshCw, Search, Users, GraduationCap, Eye, EyeOff, Copy, Check, AlertCircle } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';

const PasswordManagement = () => {
  const [activeTab, setActiveTab] = useState('students');
  const [search, setSearch] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [showPasswords, setShowPasswords] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [bulkResetResults, setBulkResetResults] = useState(null);
  
  const queryClient = useQueryClient();

  const { data: gradesData } = useQuery('grades', adminAPI.getGrades);

  const { data: classesData } = useQuery('classes', adminAPI.getClasses);

  const { data: studentsData, isLoading: studentsLoading, refetch: refetchStudents } = useQuery(
    ['studentPasswords', search, selectedGrade, selectedClass],
    () => passwordsAPI.getStudentPasswords({ 
      search, 
      grade_id: selectedGrade || undefined, 
      class_id: selectedClass || undefined 
    }),
    { enabled: activeTab === 'students' }
  );

  const { data: teachersData, isLoading: teachersLoading, refetch: refetchTeachers } = useQuery(
    ['teacherPasswords', search],
    () => passwordsAPI.getTeacherPasswords({ search }),
    { enabled: activeTab === 'teachers' }
  );

  const resetPasswordMutation = useMutation(
    ({ userId, customPassword }) => passwordsAPI.resetPassword(userId, customPassword),
    {
      onSuccess: (response) => {
        const newPassword = response.data.data.newPassword;
        alert(`Password reset successfully!\n\nNew password: ${newPassword}\n\nPlease share this with the user.`);
        if (activeTab === 'students') {
          refetchStudents();
        } else {
          refetchTeachers();
        }
      },
      onError: (error) => {
        alert(error.response?.data?.message || 'Failed to reset password');
      }
    }
  );

  const bulkResetMutation = useMutation(
    (userIds) => passwordsAPI.bulkResetPasswords(userIds),
    {
      onSuccess: (response) => {
        setBulkResetResults(response.data.data.results);
        setSelectedUsers([]);
        if (activeTab === 'students') {
          refetchStudents();
        } else {
          refetchTeachers();
        }
      },
      onError: (error) => {
        alert(error.response?.data?.message || 'Failed to reset passwords');
      }
    }
  );

  const grades = gradesData?.data?.grades || [];
  const classes = classesData?.data?.classes || [];
  const students = studentsData?.data?.students || [];
  const teachers = teachersData?.data?.teachers || [];

  const filteredClasses = selectedGrade 
    ? classes.filter(c => c.grade_id === parseInt(selectedGrade))
    : classes;

  const handleResetPassword = (user) => {
    const customPassword = window.prompt(
      `Generate new password for ${user.first_name} ${user.last_name}?\n\nLeave blank for automatic password, or enter a custom password:`,
      ''
    );
    if (customPassword !== null) {
      resetPasswordMutation.mutate({ userId: user.id, customPassword: customPassword || undefined });
    }
  };

  const handleBulkReset = () => {
    if (selectedUsers.length === 0) {
      alert('Please select users to reset passwords');
      return;
    }
    if (window.confirm(`Reset passwords for ${selectedUsers.length} selected users?`)) {
      bulkResetMutation.mutate(selectedUsers);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const toggleSelectAll = (users) => {
    if (selectedUsers.length === users.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(users.map(u => u.id));
    }
  };

  const togglePasswordVisibility = (userId) => {
    setShowPasswords(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  const copyPassword = async (password, userId) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopiedId(userId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const isLoading = activeTab === 'students' ? studentsLoading : teachersLoading;
  const users = activeTab === 'students' ? students : teachers;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Key className="h-8 w-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Password Management</h2>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
          <div>
            <h4 className="font-medium text-yellow-800">Password Security</h4>
            <p className="text-sm text-yellow-700 mt-1">
              Passwords shown here are display copies. When you reset a password, a new easy-to-remember password is generated 
              (like "HappyLion42" or "BraveTiger78"). Share the new password with the user securely.
            </p>
          </div>
        </div>
      </div>

      <div className="flex space-x-4">
        <button
          onClick={() => { setActiveTab('students'); setSelectedUsers([]); setBulkResetResults(null); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'students'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <GraduationCap className="h-5 w-5" />
          <span>Students</span>
        </button>
        <button
          onClick={() => { setActiveTab('teachers'); setSelectedUsers([]); setBulkResetResults(null); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'teachers'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Users className="h-5 w-5" />
          <span>Teachers</span>
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder={`Search ${activeTab}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {activeTab === 'students' && (
            <>
              <select
                value={selectedGrade}
                onChange={(e) => { setSelectedGrade(e.target.value); setSelectedClass(''); }}
                className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Grades</option>
                {grades.map(grade => (
                  <option key={grade.id} value={grade.id}>{grade.name}</option>
                ))}
              </select>

              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Classes</option>
                {filteredClasses.map(cls => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
            </>
          )}

          {selectedUsers.length > 0 && (
            <button
              onClick={handleBulkReset}
              disabled={bulkResetMutation.isPending}
              className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${bulkResetMutation.isPending ? 'animate-spin' : ''}`} />
              <span>Reset Selected ({selectedUsers.length})</span>
            </button>
          )}
        </div>
      </div>

      {bulkResetResults && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="font-medium text-green-800 mb-3">Passwords Reset Successfully</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-green-700">
                  <th className="pb-2">Name</th>
                  {activeTab === 'students' && <th className="pb-2">Student #</th>}
                  <th className="pb-2">New Password</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="text-green-800">
                {bulkResetResults.map(result => (
                  <tr key={result.id}>
                    <td className="py-1">{result.name}</td>
                    {activeTab === 'students' && <td className="py-1">{result.studentNumber}</td>}
                    <td className="py-1 font-mono">{result.newPassword}</td>
                    <td className="py-1">
                      <button
                        onClick={() => copyPassword(result.newPassword, result.id)}
                        className="text-green-600 hover:text-green-800"
                      >
                        {copiedId === result.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => setBulkResetResults(null)}
            className="mt-3 text-sm text-green-600 hover:text-green-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedUsers.length === users.length && users.length > 0}
                    onChange={() => toggleSelectAll(users)}
                    className="h-4 w-4 text-blue-600 rounded border-gray-300"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                {activeTab === 'students' && (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Grade/Class</th>
                  </>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Password</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.length > 0 ? (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.id)}
                        onChange={() => toggleUserSelection(user.id)}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {user.first_name} {user.last_name}
                      </div>
                    </td>
                    {activeTab === 'students' && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.student_number || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.grade_name || '-'} {user.class_name ? `/ ${user.class_name}` : ''}
                        </td>
                      </>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.display_password ? (
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-sm">
                            {showPasswords[user.id] ? user.display_password : '••••••••'}
                          </span>
                          <button
                            onClick={() => togglePasswordVisibility(user.id)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {showPasswords[user.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          {showPasswords[user.id] && (
                            <button
                              onClick={() => copyPassword(user.display_password, user.id)}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              {copiedId === user.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Not set (old password)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleResetPassword(user)}
                        disabled={resetPasswordMutation.isPending}
                        className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${resetPasswordMutation.isPending ? 'animate-spin' : ''}`} />
                        <span className="text-sm">Reset</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={activeTab === 'students' ? 7 : 5} className="px-6 py-8 text-center text-gray-500">
                    No {activeTab} found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PasswordManagement;
