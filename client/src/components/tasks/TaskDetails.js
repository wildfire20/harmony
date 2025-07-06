import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { Calendar, Clock, FileText, Upload, CheckCircle, AlertTriangle, User, Users, Eye, Download, Edit, Star } from 'lucide-react';
import { tasksAPI, submissionsAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../common/LoadingSpinner';

const TaskDetails = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [submissionContent, setSubmissionContent] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { data: taskData, isLoading } = useQuery(
    ['task', id],
    () => tasksAPI.getTask(id),
    { enabled: !!id }
  );

  const task = taskData?.data?.task;

  // Submit assignment mutation
  const submitAssignmentMutation = useMutation(
    async ({ taskId, content, file }) => {
      const formData = new FormData();
      if (content) {
        formData.append('content', content);
      }
      if (file) {
        formData.append('file', file);
      }
      return submissionsAPI.submitAssignment(taskId, formData);
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['task', id]);
        setSubmissionContent('');
        setSelectedFile(null);
        setIsSubmitting(false);
        alert('Assignment submitted successfully!');
      },
      onError: (error) => {
        console.error('Submission error:', error);
        alert(error.response?.data?.message || 'Failed to submit assignment');
        setIsSubmitting(false);
      }
    }
  );

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Check file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!submissionContent.trim() && !selectedFile) {
      alert('Please provide either text content or upload a file');
      return;
    }

    setIsSubmitting(true);
    submitAssignmentMutation.mutate({
      taskId: id,
      content: submissionContent.trim(),
      file: selectedFile
    });
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDueDateStatus = (dueDate) => {
    if (!dueDate) return null;
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMs < 0) {
      return { status: 'overdue', text: 'Overdue', color: 'text-red-600 bg-red-50' };
    } else if (diffDays <= 1) {
      return { status: 'urgent', text: 'Due Soon', color: 'text-orange-600 bg-orange-50' };
    } else {
      return { status: 'normal', text: `${diffDays} days left`, color: 'text-green-600 bg-green-50' };
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Task not found</h2>
          <p className="text-gray-600">The task you're looking for doesn't exist or has been removed.</p>
        </div>
      </div>
    );
  }

  const dueDateStatus = getDueDateStatus(task.due_date);
  const isStudent = user?.role === 'student';
  const hasSubmission = task.submission;
  const isOnlineSubmission = task.submission_type === 'online' || !task.submission_type; // default to online if not specified
  const canSubmit = isStudent && isOnlineSubmission && !hasSubmission && (!task.due_date || new Date(task.due_date) > new Date());

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Task Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{task.title}</h1>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <div className="flex items-center">
                    <User className="h-4 w-4 mr-1" />
                    <span>{task.teacher_first_name} {task.teacher_last_name}</span>
                  </div>
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 mr-1" />
                    <span className="capitalize">{task.task_type}</span>
                  </div>
                  {task.submission_type && (
                    <div className="flex items-center">
                      <Upload className="h-4 w-4 mr-1" />
                      <span className="capitalize">{task.submission_type} Submission</span>
                    </div>
                  )}
                </div>
              </div>
              
              {dueDateStatus && (
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${dueDateStatus.color}`}>
                  {dueDateStatus.text}
                </div>
              )}
            </div>

            {/* Task Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {task.due_date && (
                <div className="flex items-center text-sm text-gray-600">
                  <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                  <div>
                    <span className="font-medium">Due Date:</span>
                    <div>{formatDate(task.due_date)}</div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center text-sm text-gray-600">
                <CheckCircle className="h-4 w-4 mr-2 text-gray-400" />
                <div>
                  <span className="font-medium">Max Points:</span>
                  <div>{task.max_points}</div>
                </div>
              </div>
              
              <div className="flex items-center text-sm text-gray-600">
                <Clock className="h-4 w-4 mr-2 text-gray-400" />
                <div>
                  <span className="font-medium">Created:</span>
                  <div>{formatDate(task.created_at)}</div>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="prose max-w-none">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Description</h3>
              <p className="text-gray-600 mb-4">{task.description}</p>
              
              {task.instructions && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Instructions</h3>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-gray-700">{task.instructions}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Submission Status for Students */}
        {isStudent && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Submission Status</h2>
              
              {hasSubmission ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                    <div>
                      <span className="font-medium text-green-800">Submitted</span>
                      <p className="text-sm text-green-700 mt-1">
                        Submitted on {formatDate(task.submission.submitted_at)}
                      </p>
                      {task.submission.score !== null && (
                        <p className="text-sm text-green-700">
                          Score: {task.submission.score}/{task.submission.max_score}
                        </p>
                      )}
                      {task.submission.feedback && (
                        <div className="mt-2">
                          <p className="text-sm font-medium text-green-800">Feedback:</p>
                          <p className="text-sm text-green-700">{task.submission.feedback}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {task.submission_type === 'physical' ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <FileText className="h-5 w-5 text-blue-600 mr-2" />
                        <div>
                          <span className="font-medium text-blue-800">Physical Submission Required</span>
                          <p className="text-sm text-blue-700 mt-1">
                            This assignment requires physical submission. Please submit your work directly to your teacher.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : !canSubmit ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
                        <div>
                          <span className="font-medium text-red-800">Submission Not Available</span>
                          <p className="text-sm text-red-700 mt-1">
                            {task.due_date && new Date(task.due_date) <= new Date() 
                              ? 'This assignment is past due.' 
                              : 'You have already submitted this assignment.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <Upload className="h-5 w-5 text-yellow-600 mr-2" />
                        <div>
                          <span className="font-medium text-yellow-800">Ready to Submit</span>
                          <p className="text-sm text-yellow-700 mt-1">
                            You can submit your assignment below.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submission Form for Students */}
        {canSubmit && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Submit Assignment</h2>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Text Content */}
                <div>
                  <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-2">
                    Written Response (Optional)
                  </label>
                  <textarea
                    id="content"
                    value={submissionContent}
                    onChange={(e) => setSubmissionContent(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter your response here..."
                  />
                </div>

                {/* File Upload */}
                <div>
                  <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-2">
                    File Upload (Optional)
                  </label>
                  <div className="mt-1">
                    <input
                      id="file"
                      type="file"
                      onChange={handleFileChange}
                      accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.ppt,.pptx,.xls,.xlsx"
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Accepted formats: PDF, DOC, DOCX, TXT, JPG, PNG, PPT, XLS. Max size: 10MB
                    </p>
                    {selectedFile && (
                      <div className="mt-2 text-sm text-green-600">
                        Selected: {selectedFile.name}
                      </div>
                    )}
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting || (!submissionContent.trim() && !selectedFile)}
                    className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Submit Assignment
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Teacher/Admin Submissions Management */}
        {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
          <SubmissionsManagement taskId={id} />
        )}
      </div>
    </div>
  );
};

// Submissions Management Component for Teachers/Admins
const SubmissionsManagement = ({ taskId }) => {
  const [activeTab, setActiveTab] = useState('overview');
  
  // Fetch task submissions
  const { data: submissionsData, isLoading: submissionsLoading } = useQuery(
    ['taskSubmissions', taskId],
    () => submissionsAPI.getTaskSubmissions(taskId),
    { enabled: !!taskId }
  );

  // Fetch all students for this task
  const { data: studentsData, isLoading: studentsLoading } = useQuery(
    ['taskStudents', taskId],
    () => submissionsAPI.getTaskStudents(taskId),
    { enabled: !!taskId }
  );

  const submissions = submissionsData?.data || [];
  const students = studentsData?.data?.students || [];
  
  const submittedStudents = students.filter(s => s.submission_id);
  const notSubmittedStudents = students.filter(s => !s.submission_id);
  const gradedSubmissions = submittedStudents.filter(s => s.submission_status === 'graded');
  
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (submissionsLoading || studentsLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <div className="p-6">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      <div className="p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <Users className="h-5 w-5 mr-2" />
          Submissions Management
        </h2>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-blue-800">Total Students</p>
                <p className="text-2xl font-bold text-blue-900">{students.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center">
              <CheckCircle className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-green-800">Submitted</p>
                <p className="text-2xl font-bold text-green-900">{submittedStudents.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-yellow-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-yellow-800">Pending</p>
                <p className="text-2xl font-bold text-yellow-900">{notSubmittedStudents.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center">
              <Star className="h-8 w-8 text-purple-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-purple-800">Graded</p>
                <p className="text-2xl font-bold text-purple-900">{gradedSubmissions.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('submitted')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'submitted'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Submitted ({submittedStudents.length})
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'pending'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Not Submitted ({notSubmittedStudents.length})
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Submission Overview</h3>
            {students.length === 0 ? (
              <p className="text-gray-600">No students found for this task.</p>
            ) : (
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Student
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Submitted At
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Score
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {students.map((student) => (
                      <tr key={student.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {student.first_name} {student.last_name}
                              </div>
                              <div className="text-sm text-gray-500">
                                {student.student_number}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {student.submission_id ? (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              student.submission_status === 'graded' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {student.submission_status === 'graded' ? 'Graded' : 'Submitted'}
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                              Not Submitted
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {student.submitted_at ? formatDate(student.submitted_at) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {student.score !== null && student.max_score !== null 
                            ? `${student.score}/${student.max_score}` 
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'submitted' && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Submitted Assignments</h3>
            {submittedStudents.length === 0 ? (
              <p className="text-gray-600">No submissions yet.</p>
            ) : (
              <div className="space-y-4">
                {submittedStudents.map((student) => (
                  <div key={student.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-gray-900">
                          {student.first_name} {student.last_name}
                        </h4>
                        <p className="text-sm text-gray-500">{student.student_number}</p>
                        <p className="text-sm text-gray-600">
                          Submitted: {formatDate(student.submitted_at)}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          student.submission_status === 'graded' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {student.submission_status === 'graded' ? 'Graded' : 'Submitted'}
                        </span>
                        <button className="p-2 text-gray-400 hover:text-gray-600">
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {student.score !== null && (
                      <div className="mt-2 text-sm">
                        <span className="font-medium">Score: </span>
                        <span className="text-green-600 font-medium">
                          {student.score}/{student.max_score}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'pending' && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Students Who Haven't Submitted</h3>
            {notSubmittedStudents.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <p className="text-green-600 font-medium">All students have submitted!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {notSubmittedStudents.map((student) => (
                  <div key={student.id} className="border border-red-200 rounded-lg p-4 bg-red-50">
                    <div className="flex items-center">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">
                          {student.first_name} {student.last_name}
                        </h4>
                        <p className="text-sm text-gray-500">{student.student_number}</p>
                      </div>
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                        Pending
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskDetails;
