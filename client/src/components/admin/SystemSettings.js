import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import { Plus, Edit, Trash2, School, Users, Settings } from 'lucide-react';
import { adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const SystemSettings = () => {
  const [activeSection, setActiveSection] = useState('grades');
  const [showAddGrade, setShowAddGrade] = useState(false);
  const [showAddClass, setShowAddClass] = useState(false);
  const queryClient = useQueryClient();

  const { register: registerGrade, handleSubmit: handleGradeSubmit, reset: resetGrade, formState: { errors: gradeErrors } } = useForm();
  const { register: registerClass, handleSubmit: handleClassSubmit, reset: resetClass, formState: { errors: classErrors } } = useForm();

  // Fetch grades
  const { data: gradesData, isLoading: gradesLoading } = useQuery('grades', () => adminAPI.getGrades());
  
  // Fetch classes
  const { data: classesData, isLoading: classesLoading } = useQuery('classes', () => adminAPI.getClasses());

  // Fetch teachers for class assignment
  const { data: teachersData } = useQuery('teachers', () => adminAPI.getTeachers());

  // Add grade mutation
  const addGradeMutation = useMutation(
    (data) => adminAPI.addGrade(data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['grades']);
        setShowAddGrade(false);
        resetGrade();
        toast.success('Grade added successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to add grade');
      }
    }
  );

  // Add class mutation
  const addClassMutation = useMutation(
    (data) => adminAPI.addClass(data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['classes']);
        setShowAddClass(false);
        resetClass();
        toast.success('Class added successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to add class');
      }
    }
  );

  // Delete grade mutation
  const deleteGradeMutation = useMutation(
    (id) => adminAPI.deleteGrade(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['grades']);
        toast.success('Grade deleted successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete grade');
      }
    }
  );

  // Delete class mutation
  const deleteClassMutation = useMutation(
    (id) => adminAPI.deleteClass(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['classes']);
        toast.success('Class deleted successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete class');
      }
    }
  );

  const grades = gradesData?.data?.grades || [];
  const classes = classesData?.data?.classes || [];
  const teachers = teachersData?.data?.teachers || [];

  const onGradeSubmit = (data) => {
    addGradeMutation.mutate(data);
  };

  const onClassSubmit = (data) => {
    addClassMutation.mutate(data);
  };

  const handleDeleteGrade = (id, name) => {
    if (window.confirm(`Are you sure you want to delete ${name}? This will affect all students and classes in this grade.`)) {
      deleteGradeMutation.mutate(id);
    }
  };

  const handleDeleteClass = (id, name) => {
    if (window.confirm(`Are you sure you want to delete ${name}? This will affect all students in this class.`)) {
      deleteClassMutation.mutate(id);
    }
  };

  const sections = [
    { id: 'grades', name: 'Grades', icon: School },
    { id: 'classes', name: 'Classes', icon: Users },
    { id: 'general', name: 'General Settings', icon: Settings },
  ];

  if (gradesLoading || classesLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">System Settings</h2>
      </div>

      {/* Section Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`${
                  activeSection === section.id
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2`}
              >
                <Icon className="h-4 w-4" />
                <span>{section.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Grades Section */}
      {activeSection === 'grades' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Grade Management</h3>
            <button
              onClick={() => setShowAddGrade(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Add Grade</span>
            </button>
          </div>

          {/* Add Grade Form */}
          {showAddGrade && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-semibold text-gray-900">Add New Grade</h4>
                <button
                  onClick={() => setShowAddGrade(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleGradeSubmit(onGradeSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Grade Name *
                  </label>
                  <input
                    {...registerGrade('name', { required: 'Grade name is required' })}
                    placeholder="e.g., Grade 1, Grade 2"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  {gradeErrors.name && (
                    <p className="text-red-500 text-sm mt-1">{gradeErrors.name.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    {...registerGrade('description')}
                    placeholder="Optional description"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
                <div className="md:col-span-2 flex space-x-3">
                  <button
                    type="submit"
                    disabled={addGradeMutation.isLoading}
                    className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {addGradeMutation.isLoading ? 'Adding...' : 'Add Grade'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddGrade(false)}
                    className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Grades List */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Grade Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Students
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Classes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {grades.map((grade) => (
                  <tr key={grade.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {grade.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {grade.description || 'No description'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {grade.student_count || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {grade.class_count || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        className="text-green-600 hover:text-green-900"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteGrade(grade.id, grade.name)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Classes Section */}
      {activeSection === 'classes' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Class Management</h3>
            <button
              onClick={() => setShowAddClass(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Add Class</span>
            </button>
          </div>

          {/* Add Class Form */}
          {showAddClass && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-semibold text-gray-900">Add New Class</h4>
                <button
                  onClick={() => setShowAddClass(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleClassSubmit(onClassSubmit)} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Class Name *
                  </label>
                  <input
                    {...registerClass('name', { required: 'Class name is required' })}
                    placeholder="e.g., Class A, Section 1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {classErrors.name && (
                    <p className="text-red-500 text-sm mt-1">{classErrors.name.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Grade *
                  </label>
                  <select
                    {...registerClass('grade_id', { required: 'Grade is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select Grade</option>
                    {grades.map((grade) => (
                      <option key={grade.id} value={grade.id}>
                        {grade.name}
                      </option>
                    ))}
                  </select>
                  {classErrors.grade_id && (
                    <p className="text-red-500 text-sm mt-1">{classErrors.grade_id.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teacher
                  </label>
                  <select
                    {...registerClass('teacher_id')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">No teacher assigned</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.first_name} {teacher.last_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3 flex space-x-3">
                  <button
                    type="submit"
                    disabled={addClassMutation.isLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addClassMutation.isLoading ? 'Adding...' : 'Add Class'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddClass(false)}
                    className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Classes List */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Class Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Grade
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Teacher
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Students
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {classes.map((classItem) => (
                  <tr key={classItem.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {classItem.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {classItem.grade_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {classItem.teacher_name || 'Not assigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {classItem.student_count || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClass(classItem.id, classItem.name)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* General Settings Section */}
      {activeSection === 'general' && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-gray-900">General Settings</h3>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <p className="text-gray-600">
              General system settings will be available in future updates. This will include:
            </p>
            <ul className="mt-4 text-sm text-gray-600 space-y-2">
              <li>• School information and branding</li>
              <li>• Academic year settings</li>
              <li>• Grading scales and policies</li>
              <li>• Notification preferences</li>
              <li>• Security settings</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemSettings;
