import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { ArrowRight, AlertTriangle, CheckCircle, Users, ArrowUpCircle } from 'lucide-react';
import { adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const GradePromotion = () => {
  const [fromGrade, setFromGrade] = useState('');
  const [toGrade, setToGrade] = useState('');
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const queryClient = useQueryClient();

  const { data: previewData, isLoading } = useQuery(
    'gradePromotionPreview',
    () => adminAPI.getGradePromotionPreview(),
    {
      refetchOnWindowFocus: false
    }
  );

  const promoteMutation = useMutation(
    ({ fromGradeId, toGradeId }) => adminAPI.promoteGrade(fromGradeId, toGradeId),
    {
      onSuccess: (response) => {
        queryClient.invalidateQueries('gradePromotionPreview');
        queryClient.invalidateQueries(['students']);
        toast.success(response.data?.message || 'Students promoted successfully!');
        setFromGrade('');
        setToGrade('');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to promote students');
      }
    }
  );

  const bulkPromoteMutation = useMutation(
    () => adminAPI.bulkPromoteGrades(),
    {
      onSuccess: (response) => {
        queryClient.invalidateQueries('gradePromotionPreview');
        queryClient.invalidateQueries(['students']);
        toast.success(response.data?.message || 'All students promoted successfully!');
        setShowBulkConfirm(false);
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to promote students');
        setShowBulkConfirm(false);
      }
    }
  );

  const grades = previewData?.data?.grades || [];

  const handlePromote = () => {
    if (!fromGrade || !toGrade) {
      toast.error('Please select both source and destination grades');
      return;
    }
    if (fromGrade === toGrade) {
      toast.error('Source and destination grades cannot be the same');
      return;
    }

    const fromGradeData = grades.find(g => g.id === parseInt(fromGrade));
    const toGradeData = grades.find(g => g.id === parseInt(toGrade));
    
    if (window.confirm(`Are you sure you want to move ${fromGradeData?.active_students || 0} students from ${fromGradeData?.name} to ${toGradeData?.name}?\n\nThis action cannot be undone.`)) {
      promoteMutation.mutate({ fromGradeId: fromGrade, toGradeId: toGrade });
    }
  };

  const handleBulkPromote = () => {
    setShowBulkConfirm(true);
  };

  const confirmBulkPromote = () => {
    bulkPromoteMutation.mutate();
  };

  if (isLoading) return <LoadingSpinner />;

  const totalStudents = grades.reduce((sum, g) => sum + parseInt(g.active_students || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Grade Promotion</h2>
          <p className="text-gray-600 mt-1">Move students to the next grade level for the new school year</p>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
          <div>
            <h3 className="font-medium text-yellow-800">Important Notice</h3>
            <p className="text-yellow-700 text-sm mt-1">
              Grade promotion will move all active students from one grade to another. 
              Students will need to be reassigned to classes after promotion. 
              Archived students are not affected.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Student Distribution</h3>
          <div className="space-y-3">
            {grades.map((grade) => (
              <div key={grade.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="font-medium text-gray-900">{grade.name}</span>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-green-600 font-medium">
                    {grade.active_students} active
                  </span>
                  {parseInt(grade.archived_students) > 0 && (
                    <span className="text-sm text-gray-400">
                      ({grade.archived_students} archived)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-gray-900">Total Active Students</span>
              <span className="text-lg font-bold text-blue-600">{totalStudents}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Promote Single Grade</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Grade</label>
                <select
                  value={fromGrade}
                  onChange={(e) => setFromGrade(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select source grade</option>
                  {grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      {grade.name} ({grade.active_students} students)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="h-6 w-6 text-gray-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To Grade</label>
                <select
                  value={toGrade}
                  onChange={(e) => setToGrade(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select destination grade</option>
                  {grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      {grade.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handlePromote}
                disabled={promoteMutation.isLoading || !fromGrade || !toGrade}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {promoteMutation.isLoading ? (
                  <span>Promoting...</span>
                ) : (
                  <>
                    <ArrowUpCircle className="h-4 w-4" />
                    <span>Promote Students</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Promote All Grades</h3>
            <p className="text-gray-600 text-sm mb-4">
              Move all students to their next grade level at once. Grade 1 goes to Grade 2, 
              Grade 2 goes to Grade 3, and so on.
            </p>
            
            {!showBulkConfirm ? (
              <button
                onClick={handleBulkPromote}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-2 px-4 rounded-md hover:from-green-700 hover:to-emerald-700 flex items-center justify-center space-x-2"
              >
                <ArrowUpCircle className="h-4 w-4" />
                <span>Promote All Grades (End of Year)</span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-red-800 text-sm font-medium">
                    Are you sure? This will promote ALL {totalStudents} students to their next grade level.
                  </p>
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowBulkConfirm(false)}
                    className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmBulkPromote}
                    disabled={bulkPromoteMutation.isLoading}
                    className="flex-1 bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    {bulkPromoteMutation.isLoading ? 'Promoting...' : 'Yes, Promote All'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {(promoteMutation.isSuccess || bulkPromoteMutation.isSuccess) && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <h3 className="font-medium text-green-800">Promotion Complete</h3>
              <p className="text-green-700 text-sm mt-1">
                Students have been moved to their new grades. Remember to assign students to their new classes.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GradePromotion;
