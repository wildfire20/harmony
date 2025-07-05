import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, Edit, Trash2, Download, Upload } from 'lucide-react';
import { adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const StudentManagement = () => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  // Fetch students
  const { data: studentsData, isLoading } = useQuery(
    ['students', searchTerm, selectedGrade],
    () => adminAPI.getStudents({ 
      search: searchTerm, 
      grade: selectedGrade === 'all' ? '' : selectedGrade 
    })
  );

  // Fetch grades for dropdown
  const { data: gradesData, error: gradesError, isLoading: gradesLoading } = useQuery('grades', () => adminAPI.getGrades(), {
    onError: (error) => {
      console.error('Failed to fetch grades:', error);
      toast.error('Failed to load grades');
    }
  });

  // Fetch classes for dropdown
  const { data: classesData, error: classesError, isLoading: classesLoading } = useQuery('classes', () => adminAPI.getClasses(), {
    onError: (error) => {
      console.error('Failed to fetch classes:', error);
      toast.error('Failed to load classes');
    }
  });

  // Add student mutation
  const addStudentMutation = useMutation(
    (data) => {
      console.log('Making API call with data:', data);
      return adminAPI.addStudent(data);
    },
    {
      onSuccess: (response) => {
        console.log('Student added successfully:', response);
        queryClient.invalidateQueries(['students']);
        setShowAddForm(false);
        reset();
        toast.success('Student added successfully!');
      },
      onError: (error) => {
        console.error('Add student error:', error);
        console.error('Error response:', error.response?.data);
        const errorMessage = error.response?.data?.message || 
                           error.response?.data?.errors?.[0]?.msg || 
                           'Failed to add student';
        toast.error(errorMessage);
      }
    }
  );

  // Update student mutation
  const updateStudentMutation = useMutation(
    ({ id, data }) => {
      console.log('Updating student:', id, data);
      return adminAPI.updateStudent(id, data);
    },
    {
      onSuccess: (response) => {
        console.log('Student updated successfully:', response);
        queryClient.invalidateQueries(['students']);
        setEditingStudent(null);
        setShowAddForm(false);
        reset();
        toast.success('Student updated successfully!');
      },
      onError: (error) => {
        console.error('Update student error:', error);
        console.error('Error response:', error.response?.data);
        const errorMessage = error.response?.data?.message || 
                           error.response?.data?.errors?.[0]?.msg || 
                           'Failed to update student';
        toast.error(errorMessage);
      }
    }
  );
  const deleteStudentMutation = useMutation(
    (id) => adminAPI.deleteStudent(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['students']);
        toast.success('Student deleted successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete student');
      }
    }
  );

  const students = studentsData?.data?.students || [];
  const grades = gradesData?.data?.grades || [];
  const classes = classesData?.data?.classes || [];

  // Debug logging
  console.log('Grades data:', gradesData);
  console.log('Processed grades:', grades);
  console.log('Grades error:', gradesError);
  console.log('Classes data:', classesData);
  console.log('Processed classes:', classes);
  console.log('Classes error:', classesError);

  const onSubmit = (data) => {
    console.log('Form data being submitted:', data);
    
    if (editingStudent) {
      updateStudentMutation.mutate({ id: editingStudent.id, data });
    } else {
      addStudentMutation.mutate(data);
    }
  };

  const handleEdit = (student) => {
    setEditingStudent(student);
    setShowAddForm(true);
    reset({
      first_name: student.first_name,
      last_name: student.last_name,
      student_number: student.student_number,
      grade_id: student.grade_id,
      class_id: student.class_id
    });
  };

  const handleCancelEdit = () => {
    setEditingStudent(null);
    setShowAddForm(false);
    reset();
  };

  const handleDelete = (id, name) => {
    if (window.confirm(`Are you sure you want to delete ${name}?`)) {
      deleteStudentMutation.mutate(id);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Student Management</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Add Student</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search students..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Grades</option>
              {grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Add Student Form */}
      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {editingStudent ? 'Edit Student' : 'Add New Student'}
            </h3>
            <button
              onClick={handleCancelEdit}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name *
              </label>
              <input
                {...register('first_name', { required: 'First name is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {errors.first_name && (
                <p className="text-red-500 text-sm mt-1">{errors.first_name.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name *
              </label>
              <input
                {...register('last_name', { required: 'Last name is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {errors.last_name && (
                <p className="text-red-500 text-sm mt-1">{errors.last_name.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Student Number
              </label>
              <input
                {...register('student_number')}
                placeholder="Auto-generated if empty"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grade *
              </label>
              <select
                {...register('grade_id', { required: 'Grade is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select Grade</option>
                {grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
              {errors.grade_id && (
                <p className="text-red-500 text-sm mt-1">{errors.grade_id.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Class
              </label>
              <select
                {...register('class_id')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select Class (Optional)</option>
                {classes.map((classItem) => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name} (Grade {classItem.grade_name || classItem.grade_id})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex space-x-3">
              <button
                type="submit"
                disabled={addStudentMutation.isLoading || updateStudentMutation.isLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {(addStudentMutation.isLoading || updateStudentMutation.isLoading) 
                  ? (editingStudent ? 'Updating...' : 'Adding...') 
                  : (editingStudent ? 'Update Student' : 'Add Student')
                }
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Students Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Student
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Student Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Grade
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Class
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {students.length > 0 ? (
                students.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {student.first_name} {student.last_name}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.student_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.grade_name || 'Not assigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.class_name || 'Not assigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        student.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {student.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleEdit(student)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(student.id, `${student.first_name} ${student.last_name}`)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-gray-500">
                    No students found. Click "Add Student" to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StudentManagement;
