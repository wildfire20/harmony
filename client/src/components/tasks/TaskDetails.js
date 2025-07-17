import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  FileText, 
  User, 
  Upload, 
  Download, 
  CheckCircle, 
  AlertTriangle,
  Edit,
  X,
  Users,
  Star,
  Eye
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { tasksAPI, submissionsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const TaskDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // State for submission form
  const [submissionContent, setSubmissionContent] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Grading modal state
  const [gradingModal, setGradingModal] = useState({
    isOpen: false,
    submission: null
  });
  const [gradeValue, setGradeValue] = useState('');
  const [feedback, setFeedback] = useState('');
  const [gradedDocumentFile, setGradedDocumentFile] = useState(null);
  const [isGrading, setIsGrading] = useState(false);

  // Document marking modal state
  const [markingModal, setMarkingModal] = useState({
    isOpen: false,
    submission: null,
    documentUrl: null
  });
  const [markingData, setMarkingData] = useState({
    annotations: [],
    comments: '',
    score: ''
  });
  const [currentAnnotation, setCurrentAnnotation] = useState('');

  // Fetch task details
  const { data: taskResponse, isLoading, error } = useQuery(
    ['task', id],
    () => tasksAPI.getTask(id),
    { 
      enabled: !!id,
      onSuccess: (data) => {
        console.log('Task API Response:', data);
      },
      onError: (error) => {
        console.error('Task API Error:', error);
      }
    }
  );

  // Extract task from response  
  const task = taskResponse?.task || taskResponse?.data?.task;
  
  console.log('TaskResponse:', taskResponse);
  console.log('Extracted Task:', task);

  // Manual test of submissions API
  React.useEffect(() => {
    if (id && user?.role === 'teacher') {
      console.log('🧪 Testing submissions API manually for task:', id);
      
      // Test direct fetch
      fetch(`/api/submissions/task/${id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      })
      .then(response => {
        console.log('🧪 Direct fetch response status:', response.status);
        return response.json();
      })
      .then(data => {
        console.log('🧪 Direct fetch response data:', data);
      })
      .catch(error => {
        console.error('🧪 Direct fetch error:', error);
      });
    }
  }, [id, user]);

  // Debug logging
  console.log('🔍 TaskDetails Debug:', {
    taskResponse,
    task,
    taskId: id,
    rawData: taskResponse?.data
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-lg mx-auto p-6">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Task</h2>
          <p className="text-gray-600 mb-4">
            {error.response?.data?.message || 'Failed to load task details'}
          </p>
          <button 
            onClick={() => navigate('/tasks')} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Tasks
          </button>
        </div>
      </div>
    );
  }

  // No task data
  if (!task) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-lg mx-auto p-6">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Task Not Found</h2>
          <p className="text-gray-600 mb-4">
            The task you're looking for doesn't exist or you don't have permission to view it.
          </p>
          <button 
            onClick={() => navigate('/tasks')} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Tasks
          </button>
        </div>
      </div>
    );
  }

  // Ensure task exists before proceeding
  if (!task) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-lg mx-auto p-6">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Task Not Found</h2>
          <p className="text-gray-600 mb-4">
            The task you're looking for doesn't exist or you don't have permission to view it.
          </p>
          <button 
            onClick={() => navigate('/tasks')} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Tasks
          </button>
        </div>
      </div>
    );
  }

  const dueDateStatus = getDueDateStatus(task?.due_date);
  const isStudent = user?.role === 'student';
  const hasSubmission = task?.submission;
  const isOnlineSubmission = task?.submission_type === 'online' || !task?.submission_type;
  // Allow submission/resubmission before deadline (even if student already submitted)
  const canSubmit = isStudent && isOnlineSubmission && (!task?.due_date || new Date(task.due_date) > new Date());

  // Format date helper
  const formatDate = (dateString) => {
    if (!dateString) return 'No date set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // File change handler
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Submit assignment handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!submissionContent.trim() && !selectedFile) {
      toast.error('Please provide either written content or upload a file');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const formData = new FormData();
      formData.append('task_id', id);
      formData.append('content', submissionContent);
      
      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      await submissionsAPI.submitAssignment(id, formData);
      toast.success('Assignment submitted successfully!');
      
      // Force refresh of task data to show updated submission status
      await queryClient.invalidateQueries(['task', id]);
      await queryClient.refetchQueries(['task', id]);
      
      setSubmissionContent('');
      setSelectedFile(null);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to submit assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Download attachment handler
  const handleDownloadAttachment = async (taskId) => {
    try {
      const response = await tasksAPI.downloadAttachment(taskId);
      
      // Check if we got a JSON response with signed URL
      if (response.data && typeof response.data === 'object' && response.data.downloadUrl) {
        console.log('Got signed URL for task attachment download');
        
        // For signed URLs, fetch the actual file content first
        try {
          const fileResponse = await fetch(response.data.downloadUrl);
          if (!fileResponse.ok) {
            throw new Error(`HTTP error! status: ${fileResponse.status}`);
          }
          
          const blob = await fileResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = response.data.fileName || task.attachment_original_name || 'task-attachment';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          
          toast.success('Download completed successfully');
        } catch (fetchError) {
          console.error('Error fetching file from signed URL:', fetchError);
          // Fallback: open the signed URL in a new tab
          window.open(response.data.downloadUrl, '_blank');
          toast.success('File opened in new tab');
        }
      } else {
        // Fallback to blob handling for backwards compatibility
        console.log('Fallback to blob download for task attachment');
        const blob = new Blob([response.data]);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = task.attachment_original_name || 'task-attachment';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Download attachment error:', error);
      toast.error('Failed to download attachment');
    }
  };

  // Download submission handler
  const handleDownloadSubmission = async (submissionId, fileName) => {
    try {
      const response = await submissionsAPI.downloadSubmission(submissionId);
      
      // Check if we got a JSON response with signed URL
      if (response.data && typeof response.data === 'object' && response.data.downloadUrl) {
        console.log('Got signed URL for submission download');
        
        // For signed URLs, fetch the actual file content first
        try {
          const fileResponse = await fetch(response.data.downloadUrl);
          if (!fileResponse.ok) {
            throw new Error(`HTTP error! status: ${fileResponse.status}`);
          }
          
          const blob = await fileResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = response.data.fileName || fileName || 'submission';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          
          toast.success('Download completed successfully');
        } catch (fetchError) {
          console.error('Error fetching file from signed URL:', fetchError);
          // Fallback: open the signed URL in a new tab
          window.open(response.data.downloadUrl, '_blank');
          toast.success('File opened in new tab');
        }
      } else {
        // Fallback to blob handling for backwards compatibility
        console.log('Fallback to blob download for submission');
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'submission';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success('Download started!');
      }
    } catch (error) {
      console.error('Download submission error:', error);
      toast.error('Failed to download submission');
    }
  };

  // Download graded document handler
  const handleDownloadGradedDocument = async (submissionId) => {
    try {
      console.log('🔽 Starting graded document download for submission:', submissionId);
      const response = await submissionsAPI.downloadGradedDocument(submissionId);
      
      // Check if we got a JSON response with signed URL
      if (response.data && typeof response.data === 'object' && response.data.downloadUrl) {
        console.log('Got signed URL for graded document download:', response.data.downloadUrl);
        
        // For signed URLs, we need to fetch the actual file content first
        try {
          console.log('🔗 Fetching file from S3 signed URL...');
          const fileResponse = await fetch(response.data.downloadUrl, {
            method: 'GET',
            mode: 'cors'
          });
          
          if (!fileResponse.ok) {
            throw new Error(`HTTP error! status: ${fileResponse.status}`);
          }
          
          console.log('✅ File fetch successful, creating blob...');
          const blob = await fileResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = response.data.fileName || 'graded-document';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          
          console.log('✅ Download completed successfully');
          toast.success('Graded document downloaded successfully');
        } catch (fetchError) {
          console.error('Error fetching file from signed URL:', fetchError);
          // Fallback: try opening the signed URL directly in a new tab
          console.log('🔄 Fallback: Opening signed URL in new tab');
          window.open(response.data.downloadUrl, '_blank');
          toast.success('Graded document opened in new tab');
        }
      } else {
        // Fallback to blob handling for backwards compatibility
        console.log('Fallback to blob download for graded document');
        const blob = new Blob([response.data]);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'graded-document';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success('Graded document download started!');
      }
    } catch (error) {
      console.error('Download graded document error:', error);
      if (error.response?.status === 404) {
        toast.error('No graded document available for this submission');
      } else {
        toast.error('Failed to download graded document');
      }
    }
  };

  // View document in new tab handler
  const handleViewDocument = async (submissionId) => {
    try {
      console.log('🔍 Opening document in new tab for submission:', submissionId);
      const response = await submissionsAPI.downloadSubmission(submissionId);
      
      // Check if we got a JSON response with signed URL
      if (response.data && typeof response.data === 'object' && response.data.downloadUrl) {
        console.log('Got signed URL for document viewing:', response.data.downloadUrl);
        
        // Create a new window with a loading message first
        const newWindow = window.open('', '_blank');
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head>
                <title>Loading Document...</title>
                <style>
                  body { 
                    font-family: Arial, sans-serif; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    height: 100vh; 
                    margin: 0; 
                    background: #f5f5f5;
                  }
                  .loader { 
                    text-align: center; 
                  }
                </style>
              </head>
              <body>
                <div class="loader">
                  <h3>Loading document...</h3>
                  <p>Please wait while we fetch your document.</p>
                </div>
              </body>
            </html>
          `);
        }
        
        // Fetch the file content and create blob URL
        try {
          const fileResponse = await fetch(response.data.downloadUrl);
          if (!fileResponse.ok) {
            throw new Error(`HTTP error! status: ${fileResponse.status}`);
          }
          
          const blob = await fileResponse.blob();
          const blobUrl = window.URL.createObjectURL(blob);
          
          // Update the window with the actual document
          if (newWindow && !newWindow.closed) {
            newWindow.location.href = blobUrl;
            
            // Clean up the blob URL after a delay
            setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
          } else {
            // If window was blocked or closed, create a new one
            window.open(blobUrl, '_blank');
            setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
          }
          
          toast.success('Document opened in new tab');
        } catch (fetchError) {
          console.error('Error fetching file from signed URL:', fetchError);
          
          // Close the loading window if it exists
          if (newWindow && !newWindow.closed) {
            newWindow.close();
          }
          
          // Fallback to download behavior
          const a = document.createElement('a');
          a.href = response.data.downloadUrl;
          a.download = response.data.fileName || 'document';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          
          toast.info('Document downloaded due to viewing restrictions');
        }
      } else {
        // Fallback: create blob URL from response data
        console.log('Creating blob URL for document viewing');
        const blob = new Blob([response.data]);
        const blobUrl = window.URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        // Clean up the blob URL after a delay
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
        toast.success('Document opened in new tab');
      }
    } catch (error) {
      console.error('View document error:', error);
      toast.error('Failed to open document');
    }
  };

  // Grading modal handlers
  const openGradingModal = (submission) => {
    setGradingModal({ isOpen: true, submission });
    setGradeValue(submission.score || '');
    setFeedback(submission.feedback || '');
  };

  const closeGradingModal = () => {
    setGradingModal({ isOpen: false, submission: null });
    setGradeValue('');
    setFeedback('');
    setGradedDocumentFile(null);
  };

  const handleSubmitGrade = async () => {
    if (!gradeValue) {
      toast.error('Please enter a grade');
      return;
    }

    setIsGrading(true);
    try {
      // First submit the grade and feedback
      await submissionsAPI.gradeSubmission(gradingModal.submission.id, {
        score: parseFloat(gradeValue),
        feedback: feedback.trim()
      });

      // If there's a graded document file, upload it
      if (gradedDocumentFile) {
        const formData = new FormData();
        formData.append('gradedDocument', gradedDocumentFile);
        
        await submissionsAPI.uploadGradedDocument(gradingModal.submission.id, formData);
        toast.success('Grade and graded document submitted successfully!');
      } else {
        toast.success('Grade submitted successfully!');
      }
      
      queryClient.invalidateQueries(['task', id]);
      closeGradingModal();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to submit grade');
    } finally {
      setIsGrading(false);
    }
  };

  // Document marking handlers
  const openMarkingModal = async (submission) => {
    try {
      console.log('Opening marking modal for submission:', submission);
      
      // First open the modal with submission data
      setMarkingModal({ 
        isOpen: true, 
        submission, 
        documentUrl: null,
        isViewOnly: false
      });
      
      // Initialize marking data
      setMarkingData({
        annotations: submission.annotations || [],
        comments: submission.teacher_comments || '',
        score: submission.score || ''
      });
      
      // Then try to get the document URL
      if (submission.file_path || submission.s3_key) {
        try {
          const response = await submissionsAPI.downloadSubmission(submission.id);
          console.log('Document URL response:', response);
          
          if (response.data && response.data.downloadUrl) {
            const documentUrl = response.data.downloadUrl;
            
            // Test if the URL is accessible (this might fail due to CORS, but that's OK)
            try {
              const testResponse = await fetch(documentUrl, { method: 'HEAD' });
              console.log('Document URL test status:', testResponse.status);
            } catch (testError) {
              console.warn('Document URL test failed (expected for CORS):', testError.message);
            }
            
            setMarkingModal(prev => ({ 
              ...prev, 
              documentUrl: documentUrl 
            }));
          } else {
            console.warn('No downloadUrl in response:', response.data);
            // Still show the modal even if document preview isn't available
          }
        } catch (urlError) {
          console.error('Error getting document URL:', urlError);
          // Still show the modal even if document preview isn't available
        }
      } else {
        console.warn('No file_path or s3_key found for submission:', submission);
      }
    } catch (error) {
      console.error('Error opening marking modal:', error);
      toast.error('Failed to open marking modal');
    }
  };

  const closeMarkingModal = () => {
    setMarkingModal({ isOpen: false, submission: null, documentUrl: null, isViewOnly: false });
    setMarkingData({ annotations: [], comments: '', score: '' });
    setCurrentAnnotation('');
  };

  const handleSaveMarking = async () => {
    try {
      console.log('Saving marking data:', {
        submissionId: markingModal.submission.id,
        annotations: markingData.annotations,
        teacher_comments: markingData.comments,
        score: parseFloat(markingData.score) || 0
      });

      await submissionsAPI.saveMarking(markingModal.submission.id, {
        annotations: markingData.annotations,
        teacher_comments: markingData.comments,
        score: parseFloat(markingData.score) || 0
      });
      
      toast.success('Marking saved successfully!');
      queryClient.invalidateQueries(['task', id]);
      closeMarkingModal();
    } catch (error) {
      console.error('Save marking error:', error);
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.errors?.[0]?.msg || 
                          'Failed to save marking. Please try again.';
      toast.error(errorMessage);
    }
  };

  // View marked document (for students)
  const viewMarkedDocument = async (submissionId) => {
    try {
      const response = await submissionsAPI.getMarkedDocument(submissionId);
      
      if (response.data && response.data.success) {
        // Create a modal or new window to show the marked document
        setMarkingModal({
          isOpen: true,
          submission: response.data.submission,
          documentUrl: null, // We'll handle this differently for viewing
          isViewOnly: true
        });
        
        // Get the document URL for viewing
        const docResponse = await submissionsAPI.downloadSubmission(submissionId);
        if (docResponse.data && docResponse.data.downloadUrl) {
          setMarkingModal(prev => ({
            ...prev,
            documentUrl: docResponse.data.downloadUrl
          }));
        }
      }
    } catch (error) {
      console.error('View marked document error:', error);
      toast.error('Failed to load marked document');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/tasks')}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Back to Tasks
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Task Details */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
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
            <div className="prose prose-sm max-w-none">
              {task.description && (
                <div className="mb-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Description</h3>
                  <p className="text-gray-700">{task.description}</p>
                </div>
              )}
              
              {task.instructions && (
                <div className="mb-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Instructions</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{task.instructions}</p>
                </div>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-sm text-gray-500">Due Date</div>
                  <div className="font-medium text-gray-900">
                    {task.due_date ? formatDate(task.due_date) : 'No deadline'}
                  </div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-sm text-gray-500">Max Points</div>
                  <div className="font-medium text-gray-900">{task.max_points || 'Not specified'}</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-sm text-gray-500">Submission Type</div>
                  <div className="font-medium text-gray-900 capitalize">
                    {task.submission_type || 'Not specified'}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Download Attachment Button */}
            {task.attachment_s3_key && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <button
                  onClick={() => handleDownloadAttachment(task.id)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Attachment
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Submission Status for Students */}
        {isStudent && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
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
                          Score: {task.submission.score}/{task.max_points}
                        </p>
                      )}
                      {task.submission.feedback && (
                        <div className="mt-2">
                          <p className="text-sm font-medium text-green-800">Feedback:</p>
                          <p className="text-sm text-green-700">{task.submission.feedback}</p>
                        </div>
                      )}
                      {task.submission.teacher_comments && (
                        <div className="mt-2">
                          <p className="text-sm font-medium text-green-800">Teacher Comments:</p>
                          <p className="text-sm text-green-700">{task.submission.teacher_comments}</p>
                        </div>
                      )}
                      {task.submission.status === 'graded' && (task.submission.file_path || task.submission.s3_key) && (
                        <div className="mt-3">
                          <button
                            onClick={() => viewMarkedDocument(task.submission.id)}
                            className="inline-flex items-center px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 mr-2"
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View Marked Document
                          </button>
                        </div>
                      )}
                      {task.submission.status === 'graded' && task.submission.graded_document_s3_key && (
                        <div className="mt-3">
                          <button
                            onClick={() => handleDownloadGradedDocument(task.submission.id)}
                            className="inline-flex items-center px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Download Graded Document
                          </button>
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
                            This assignment is past due.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center">
                        <Upload className="h-5 w-5 text-yellow-600 mr-2" />
                        <div>
                          <span className="font-medium text-yellow-800">
                            {hasSubmission ? 'Resubmit Assignment' : 'Ready to Submit'}
                          </span>
                          <p className="text-sm text-yellow-700 mt-1">
                            {hasSubmission ? 'You can submit a new version to replace your previous submission.' : 'You can submit your assignment below.'}
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
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {selectedFile && (
                      <p className="mt-2 text-sm text-green-600">
                        Selected: {selectedFile.name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting || (!submissionContent.trim() && !selectedFile)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        {hasSubmission ? 'Resubmit Assignment' : 'Submit Assignment'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Teacher/Admin Submissions Management */}
        {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && task && (
          <TeacherSubmissionsView 
            taskId={task.id} 
            onDownloadSubmission={handleDownloadSubmission}
            onOpenGradingModal={openGradingModal}
            onOpenMarkingModal={openMarkingModal}
            onViewDocument={handleViewDocument}
          />
        )}
      </div>

      {/* Grading Modal */}
      {gradingModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Grade Submission
              </h3>
              <button
                onClick={closeGradingModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {gradingModal.submission && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600 mb-2">Student:</p>
                  <p className="font-medium text-gray-900">
                    {gradingModal.submission.first_name} {gradingModal.submission.last_name}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Grade (0-100)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={gradeValue}
                    onChange={(e) => setGradeValue(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter grade..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Feedback (Optional)
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter feedback for the student..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Upload Graded Document (Optional)
                  </label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                    <div className="space-y-1 text-center">
                      <svg
                        className="mx-auto h-12 w-12 text-gray-400"
                        stroke="currentColor"
                        fill="none"
                        viewBox="0 0 48 48"
                        aria-hidden="true"
                      >
                        <path
                          d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <div className="flex text-sm text-gray-600">
                        <label
                          htmlFor="graded-document-upload"
                          className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
                        >
                          <span>Upload graded document</span>
                          <input
                            id="graded-document-upload"
                            name="graded-document-upload"
                            type="file"
                            className="sr-only"
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            onChange={(e) => setGradedDocumentFile(e.target.files[0])}
                          />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        PDF, DOC, DOCX, JPG, PNG up to 10MB
                      </p>
                      {gradedDocumentFile && (
                        <div className="mt-2">
                          <p className="text-sm text-green-600">
                            Selected: {gradedDocumentFile.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => setGradedDocumentFile(null)}
                            className="mt-1 text-xs text-red-600 hover:text-red-800"
                          >
                            Remove file
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={closeGradingModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitGrade}
                    disabled={isGrading}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isGrading ? 'Submitting...' : 'Submit Grade'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Document Marking Modal */}
      {markingModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-6xl mx-4 h-5/6 flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {markingModal.isViewOnly ? 'View Marked Document' : 'Mark Document'} - {markingModal.submission?.first_name} {markingModal.submission?.last_name}
              </h3>
              <button
                onClick={closeMarkingModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Document Viewer */}
              <div className="flex-1 bg-gray-50 p-4">
                <div className="bg-white rounded-lg shadow h-full">
                  {markingModal.documentUrl ? (
                    <div className="h-full flex flex-col">
                      {/* Document Viewer Header */}
                      <div className="p-4 border-b border-gray-200 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-gray-900">Document Preview</h4>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => window.open(markingModal.documentUrl, '_blank')}
                              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Open in New Tab
                            </button>
                            <button
                              onClick={() => {
                                const a = document.createElement('a');
                                a.href = markingModal.documentUrl;
                                a.download = markingModal.submission?.original_file_name || 'document';
                                a.click();
                              }}
                              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          File: {markingModal.submission?.original_file_name || 'Document'}
                        </p>
                      </div>
                      
                      {/* Document Viewer - Enhanced for Better Compatibility */}
                      <div className="flex-1 relative">
                        {(() => {
                          const fileType = markingModal.submission?.file_type || '';
                          const isImage = fileType.includes('image/');
                          const isPDF = fileType.includes('pdf');
                          
                          if (isImage) {
                            // For images, display directly
                            return (
                              <div className="flex items-center justify-center h-full p-4">
                                <img
                                  src={markingModal.documentUrl}
                                  alt="Student submission"
                                  className="max-w-full max-h-full object-contain shadow-lg rounded"
                                  onError={(e) => {
                                    console.error('Image failed to load');
                                    e.target.style.display = 'none';
                                    e.target.nextElementSibling.style.display = 'block';
                                  }}
                                />
                                <div className="hidden text-center">
                                  <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                                  <p className="text-gray-600">Image could not be loaded</p>
                                  <button
                                    onClick={() => window.open(markingModal.documentUrl, '_blank')}
                                    className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                  >
                                    Open in New Tab
                                  </button>
                                </div>
                              </div>
                            );
                          } else {
                            // For all other files, provide download/view options
                            return (
                              <div className="flex items-center justify-center h-full">
                                <div className="text-center max-w-md mx-auto p-6">
                                  <div className="mb-6">
                                    {isPDF ? (
                                      <div className="bg-red-100 p-4 rounded-lg mb-4">
                                        <FileText className="h-16 w-16 text-red-600 mx-auto mb-4" />
                                        <h3 className="text-lg font-medium text-gray-900 mb-2">PDF Document</h3>
                                      </div>
                                    ) : (
                                      <div className="bg-blue-100 p-4 rounded-lg mb-4">
                                        <FileText className="h-16 w-16 text-blue-600 mx-auto mb-4" />
                                        <h3 className="text-lg font-medium text-gray-900 mb-2">Document File</h3>
                                      </div>
                                    )}
                                  </div>
                                  
                                  <p className="text-gray-600 mb-4">
                                    <strong>File:</strong> {markingModal.submission?.original_file_name || 'Document'}
                                  </p>
                                  
                                  <p className="text-sm text-gray-500 mb-6">
                                    Click below to view or download the document for review
                                  </p>
                                  
                                  <div className="space-y-3">
                                    <button
                                      onClick={() => window.open(markingModal.documentUrl, '_blank')}
                                      className="block w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                    >
                                      📖 Open Document in New Tab
                                    </button>
                                    <button
                                      onClick={() => {
                                        const a = document.createElement('a');
                                        a.href = markingModal.documentUrl;
                                        a.download = markingModal.submission?.original_file_name || 'document';
                                        a.click();
                                      }}
                                      className="block w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                                    >
                                      💾 Download Document
                                    </button>
                                  </div>
                                  
                                  <p className="text-xs text-gray-400 mt-4">
                                    Files are securely stored and accessed via encrypted URLs
                                  </p>
                                </div>
                              </div>
                            );
                          }
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600">
                          {markingModal.documentUrl === null ? 
                            'Loading document preview...' : 
                            'Document preview not available'
                          }
                        </p>
                        <p className="text-sm text-gray-500 mt-2">
                          File: {markingModal.submission?.original_file_name || 'No file attached'}
                        </p>
                        {markingModal.submission?.s3_key && (
                          <p className="text-xs text-gray-400 mt-1">
                            S3 Key: {markingModal.submission.s3_key}
                          </p>
                        )}
                        <div className="mt-4">
                          <button
                            onClick={() => {
                              console.log('Retry button clicked for submission:', markingModal.submission);
                              openMarkingModal(markingModal.submission);
                            }}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Retry Loading Document
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Marking Panel */}
              <div className="w-80 bg-white border-l border-gray-200 p-6 overflow-y-auto">
                <div className="space-y-6">
                  {/* Student Info */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Student Information</h4>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p><strong>Name:</strong> {markingModal.submission?.first_name} {markingModal.submission?.last_name}</p>
                      <p><strong>Student Number:</strong> {markingModal.submission?.student_number}</p>
                      <p><strong>Submitted:</strong> {markingModal.submission?.submitted_at ? new Date(markingModal.submission.submitted_at).toLocaleDateString() : 'N/A'}</p>
                    </div>
                  </div>

                  {markingModal.isViewOnly ? (
                    // View-only mode for students
                    <>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Teacher Comments</h4>
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-md min-h-24">
                          {markingModal.submission?.teacher_comments || 'No comments yet'}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Score</h4>
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-center">
                          <span className="text-2xl font-bold text-blue-700">
                            {markingModal.submission?.score !== null ? 
                              `${markingModal.submission.score}/100` : 
                              'Not graded yet'
                            }
                          </span>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Annotations</h4>
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-md max-h-48 overflow-y-auto">
                          {markingModal.submission?.annotations && 
                           Array.isArray(markingModal.submission.annotations) &&
                           markingModal.submission.annotations.length > 0 ? (
                            markingModal.submission.annotations.map((annotation, index) => (
                              <div key={index} className="mb-2 p-2 bg-white border border-gray-100 rounded text-sm">
                                {annotation.text || annotation}
                              </div>
                            ))
                          ) : (
                            <span className="text-gray-500">No annotations</span>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    // Marking mode for teachers
                    <>
                      {/* Score Input */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Score (0-100)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={markingData.score}
                          onChange={(e) => setMarkingData({ ...markingData, score: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Enter score..."
                        />
                      </div>

                      {/* Comments */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Teacher Comments
                        </label>
                        <textarea
                          value={markingData.comments}
                          onChange={(e) => setMarkingData({ ...markingData, comments: e.target.value })}
                          rows={6}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Add comments about the student's work, areas for improvement, or positive feedback..."
                        />
                      </div>

                      {/* Annotations */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Annotations
                        </label>
                        <div className="flex gap-2 mb-2">
                          <input
                            type="text"
                            value={currentAnnotation}
                            onChange={(e) => setCurrentAnnotation(e.target.value)}
                            placeholder="Add annotation..."
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => {
                              if (currentAnnotation.trim()) {
                                setMarkingData(prev => ({
                                  ...prev,
                                  annotations: [...prev.annotations, currentAnnotation.trim()]
                                }));
                                setCurrentAnnotation('');
                              }
                            }}
                            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                          >
                            Add
                          </button>
                        </div>
                        
                        <div className="max-h-32 overflow-y-auto space-y-1">
                          {markingData.annotations.map((annotation, index) => (
                            <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                              <span className="flex-1">{annotation}</span>
                              <button
                                onClick={() => {
                                  setMarkingData(prev => ({
                                    ...prev,
                                    annotations: prev.annotations.filter((_, i) => i !== index)
                                  }));
                                }}
                                className="ml-2 text-red-600 hover:text-red-800"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Marking Tools */}
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Marking Tools</h4>
                        <div className="space-y-2">
                          <button 
                            onClick={() => {
                              setCurrentAnnotation('Error: ');
                            }}
                            className="w-full px-3 py-2 text-sm border border-red-300 text-red-700 rounded hover:bg-red-50"
                          >
                            Add Error Annotation
                          </button>
                          <button 
                            onClick={() => {
                              setCurrentAnnotation('Warning: ');
                            }}
                            className="w-full px-3 py-2 text-sm border border-yellow-300 text-yellow-700 rounded hover:bg-yellow-50"
                          >
                            Add Warning
                          </button>
                          <button 
                            onClick={() => {
                              setCurrentAnnotation('Great work: ');
                            }}
                            className="w-full px-3 py-2 text-sm border border-green-300 text-green-700 rounded hover:bg-green-50"
                          >
                            Add Positive Note
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Action Buttons */}
                  <div className="flex space-x-3 pt-4 border-t border-gray-200">
                    <button
                      onClick={closeMarkingModal}
                      className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                    >
                      Close
                    </button>
                    {!markingModal.isViewOnly && (
                      <button
                        onClick={handleSaveMarking}
                        className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                      >
                        Save Marking
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper function for due date status
const getDueDateStatus = (dueDate) => {
  if (!dueDate) return null;
  
  const now = new Date();
  const due = new Date(dueDate);
  const diffInDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  
  if (diffInDays < 0) {
    return {
      text: 'Overdue',
      color: 'bg-red-100 text-red-800'
    };
  } else if (diffInDays === 0) {
    return {
      text: 'Due Today',
      color: 'bg-orange-100 text-orange-800'
    };
  } else if (diffInDays <= 3) {
    return {
      text: `Due in ${diffInDays} day${diffInDays > 1 ? 's' : ''}`,
      color: 'bg-yellow-100 text-yellow-800'
    };
  } else {
    return {
      text: `Due in ${diffInDays} days`,
      color: 'bg-green-100 text-green-800'
    };
  }
};

// Teacher Submissions View Component
const TeacherSubmissionsView = ({ taskId, onDownloadSubmission, onOpenGradingModal, onOpenMarkingModal, onViewDocument }) => {
  const { data: submissionsData, isLoading: submissionsLoading, error: submissionsError } = useQuery(
    ['task-submissions', taskId],
    async () => {
      const response = await submissionsAPI.getTaskSubmissions(taskId);
      console.log('React Query submissions response:', response);
      console.log('Response data:', response.data);
      return response.data; // Extract the actual data from axios response
    },
    { 
      enabled: !!taskId,
      onSuccess: (data) => {
        console.log('Submissions API Response (onSuccess):', data);
      },
      onError: (error) => {
        console.error('Submissions API Error:', error);
        console.error('Error Response:', error.response?.data);
        console.error('Error Status:', error.response?.status);
        console.error('Error Message:', error.message);
      }
    }
  );

  // Fetch students data for accurate total count
  const { data: studentsData, isLoading: studentsLoading, error: studentsError } = useQuery(
    ['task-students', taskId],
    async () => {
      const response = await submissionsAPI.getTaskStudents(taskId);
      console.log('React Query students response:', response);
      return response.data; // Extract the actual data from axios response
    },
    { 
      enabled: !!taskId,
      onSuccess: (data) => {
        console.log('Students API Response (onSuccess):', data);
      },
      onError: (error) => {
        console.error('Students API Error:', error);
        console.error('Error Response:', error.response?.data);
        console.error('Error Status:', error.response?.status);
        console.error('Error Message:', error.message);
      }
    }
  );

  const submissions = Array.isArray(submissionsData?.submissions) ? submissionsData.submissions : [];
  
  // Calculate stats
  const totalStudents = (studentsData?.data?.students || []).length;
  const submittedCount = submissions.filter(s => s.submitted_at).length;
  const gradedCount = submissions.filter(s => s.status === 'graded').length;
  const pendingCount = totalStudents - submittedCount; // Students who haven't submitted yet
  
  console.log('SubmissionsData:', submissionsData);
  console.log('Extracted Submissions:', submissions);
  console.log('Is submissions array?', Array.isArray(submissions));

  if (submissionsLoading || studentsLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Student Submissions</h3>
        <LoadingSpinner />
      </div>
    );
  }

  if (submissionsError || studentsError) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Student Submissions</h3>
        <div className="text-red-600">
          <p>Error loading data: {(submissionsError || studentsError)?.response?.data?.message || (submissionsError || studentsError)?.message}</p>
          <pre className="text-xs mt-2 bg-gray-100 p-2 rounded">
            {JSON.stringify((submissionsError || studentsError)?.response?.data, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Submissions Management Header with Stats */}
      <div className="mb-6">
        <div className="flex items-center mb-4">
          <Users className="h-5 w-5 text-gray-600 mr-2" />
          <h3 className="text-lg font-medium text-gray-900">Submissions Management</h3>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <div className="text-2xl font-bold text-blue-900">{totalStudents}</div>
                <div className="text-xs text-blue-600">Total Students</div>
                <div className="text-xs text-gray-500">Array length: {submissions.length}</div>
              </div>
            </div>
          </div>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center">
              <CheckCircle className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <div className="text-2xl font-bold text-green-900">{submittedCount}</div>
                <div className="text-xs text-green-600">Submitted</div>
                <div className="text-xs text-gray-500">Submissions: {submittedCount}</div>
              </div>
            </div>
          </div>
          
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-yellow-600 mr-3" />
              <div>
                <div className="text-2xl font-bold text-yellow-900">{pendingCount}</div>
                <div className="text-xs text-yellow-600">Pending</div>
                <div className="text-xs text-gray-500">Not submitted</div>
              </div>
            </div>
          </div>
          
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center">
              <Star className="h-8 w-8 text-purple-600 mr-3" />
              <div>
                <div className="text-2xl font-bold text-purple-900">{gradedCount}</div>
                <div className="text-xs text-purple-600">Graded</div>
                <div className="text-xs text-gray-500">Status filtered</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {submissions.length === 0 ? (
        <p className="text-gray-600">No submissions yet.</p>
      ) : (
        <div className="space-y-4">
          {Array.isArray(submissions) && submissions.map((submission) => (
            <div key={submission.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-900">
                    {submission.first_name} {submission.last_name}
                  </h4>
                  <p className="text-sm text-gray-600">
                    Student Number: {submission.student_number}
                  </p>
                  <p className="text-sm text-gray-600">
                    Submitted: {new Date(submission.submitted_at).toLocaleDateString()}
                  </p>
                  {submission.status === 'graded' && (
                    <p className="text-sm text-green-600">
                      Grade: {submission.score}/{submission.max_score}
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onOpenGradingModal(submission)}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {submission.status === 'graded' ? 'Edit Grade' : 'Grade'}
                  </button>
                  
                  {(submission.file_path || submission.s3_key) && (
                    <button
                      onClick={() => onOpenMarkingModal(submission)}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-1"
                    >
                      <Edit className="h-3 w-3" />
                      <span>Mark Document</span>
                    </button>
                  )}
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    submission.status === 'graded' 
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {submission.status}
                  </span>
                </div>
              </div>
              
              {submission.content && (
                <div className="mt-2">
                  <p className="text-sm text-gray-700">{submission.content}</p>
                </div>
              )}
              
              {(submission.file_path || submission.s3_key) && (
                <div className="mt-2 space-y-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => onDownloadSubmission(submission.id, submission.original_file_name)}
                      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download File
                    </button>
                    <button
                      onClick={() => onViewDocument(submission.id)}
                      className="inline-flex items-center text-sm text-green-600 hover:text-green-700"
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Document
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    File: {submission.original_file_name || 'attachment'}
                  </p>
                </div>
              )}

              {/* Graded Document Section */}
              {submission.status === 'graded' && submission.graded_document_s3_key && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                  <p className="text-sm font-medium text-green-800 mb-1">Graded Document:</p>
                  <button
                    onClick={() => handleDownloadGradedDocument(submission.id)}
                    className="inline-flex items-center text-sm text-green-600 hover:text-green-700"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download Graded Document ({submission.graded_document_original_name || 'graded-document'})
                  </button>
                </div>
              )}
            </div>
          ))}
          {!Array.isArray(submissions) && (
            <p className="text-red-600">Error loading submissions data.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskDetails;
