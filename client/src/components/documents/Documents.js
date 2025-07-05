import React, { useState, useEffect } from 'react';
import { Upload, Download, File, Trash2, Calendar, User, FileText, BookOpen, Clock, Clipboard, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../common/LoadingSpinner';

const Documents = () => {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    document_type: '',
    file: null,
    grade_ids: [], // Changed to array for multiple grades
    class_ids: []  // Changed to array for multiple classes
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [componentError, setComponentError] = useState(null);

  // Safety check for user and token
  if (!user || !token) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <LoadingSpinner />
          <p className="text-gray-600 mt-4">Loading user information...</p>
        </div>
      </div>
    );
  }

  // Wrap component in try-catch for any unexpected errors
  try {

  // Fetch document types
  const { data: documentTypesData, isLoading: typesLoading, error: typesError } = useQuery({
    queryKey: ['documentTypes'],
    queryFn: async () => {
      const response = await fetch('/api/documents/types', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch document types');
      }
      return response.json();
    },
    enabled: !!token
  });

  // Fetch grades for admin/teachers
  const { data: gradesData } = useQuery({
    queryKey: ['grades'],
    queryFn: async () => {
      const response = await fetch('/api/admin/grades', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch grades');
      }
      return response.json();
    },
    enabled: user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher'
  });

  // Fetch classes for admin/teachers
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => {
      const response = await fetch('/api/admin/classes', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch classes');
      }
      return response.json();
    },
    enabled: user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher'
  });

  // Fetch all documents (for admin) or user-specific documents
  const { data: documentsData, isLoading, error: documentsError } = useQuery({
    queryKey: ['documents', user?.id],
    queryFn: async () => {
      try {
        let url = '/api/documents/all';
        
        // For students, get documents for their specific grade/class
        if (user?.role === 'student') {
          console.log('=== STUDENT DOCUMENT FETCH DEBUG ===');
          console.log('User grade_id:', user.grade_id);
          console.log('User class_id:', user.class_id);
          console.log('User object:', user);
          
          if (!user.grade_id) {
            console.error('Student missing grade_id!');
            throw new Error('Student account is missing grade assignment. Please contact the administrator.');
          }
          
          if (!user.class_id) {
            console.warn('Student missing class_id, fetching grade-only documents');
            url = `/api/documents/grade/${user.grade_id}`;
          } else {
            url = `/api/documents/grade/${user.grade_id}/class/${user.class_id}`;
          }
          
          console.log('Fetching from URL:', url);
        }
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log('Documents fetch response status:', response.status);
        console.log('Documents fetch response ok:', response.ok);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Documents fetch error response:', errorText);
          
          // Handle specific error cases
          if (response.status === 404) {
            // Return empty documents array for 404 instead of throwing error
            return { documents: [], total: 0 };
          }
          
          throw new Error(`Failed to fetch documents: ${response.status} ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Documents fetch data:', data);
        return data;
      } catch (error) {
        console.error('Documents fetch error:', error);
        throw error;
      }
    },
    enabled: !!user && !!token,
    retry: (failureCount, error) => {
      // Don't retry for 404s or auth errors
      if (error.message.includes('404') || error.message.includes('401') || error.message.includes('403')) {
        return false;
      }
      return failureCount < 2;
    }
  });

  // Upload document mutation
  const uploadMutation = useMutation(
    async (formData) => {
      console.log('=== MUTATION DEBUG START ===');
      console.log('Token being sent:', token);
      console.log('FormData entries:');
      for (let [key, value] of formData.entries()) {
        console.log(key, ':', value);
      }
      console.log('=== MUTATION DEBUG END ===');
      
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      console.log('Upload response status:', response.status);
      console.log('Upload response ok:', response.ok);
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Upload error response:', error);
        throw new Error(error.message || 'Upload failed');
      }
      return response.json();
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['documents']);
        toast.success('Document uploaded successfully!');
        setShowUploadForm(false);
        setUploadForm({
          title: '',
          description: '',
          document_type: '',
          file: null,
          grade_ids: [],
          class_ids: []
        });
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to upload document');
      }
    }
  );

  // Delete document mutation
  const deleteMutation = useMutation(
    async (documentId) => {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
      return response.json();
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['documents']);
        toast.success('Document deleted successfully!');
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to delete document');
      }
    }
  );

  const documentTypes = documentTypesData?.document_types || [
    { value: 'timetable', label: 'Timetable' },
    { value: 'past_paper', label: 'Past Paper' },
    { value: 'syllabus', label: 'Syllabus' },
    { value: 'assignment', label: 'Assignment' },
    { value: 'notes', label: 'Study Notes' },
    { value: 'handbook', label: 'Handbook' },
    { value: 'form', label: 'Form' },
    { value: 'other', label: 'Other' }
  ];
  
  // Add fallback data for grades and classes to ensure dropdowns always work
  const grades = gradesData?.data?.grades || [
    { id: 1, name: 'Grade 1' },
    { id: 2, name: 'Grade 2' },
    { id: 3, name: 'Grade 3' },
    { id: 4, name: 'Grade 4' },
    { id: 5, name: 'Grade 5' },
    { id: 6, name: 'Grade 6' },
    { id: 7, name: 'Grade 7' },
    { id: 8, name: 'Grade 8' },
    { id: 9, name: 'Grade 9' },
    { id: 10, name: 'Grade 10' },
    { id: 11, name: 'Grade 11' },
    { id: 12, name: 'Grade 12' }
  ];
  
  const classes = classesData?.data?.classes || [
    { id: 1, name: 'Class A', grade_id: 1 },
    { id: 2, name: 'Class B', grade_id: 1 },
    { id: 3, name: 'Class C', grade_id: 1 },
    { id: 4, name: 'Class A', grade_id: 2 },
    { id: 5, name: 'Class B', grade_id: 2 },
    { id: 6, name: 'Class C', grade_id: 2 }
  ];
  
  const documents = documentsData?.documents || [];

  // Ensure documents is always an array
  const safeDocuments = Array.isArray(documents) ? documents : [];

  const filteredDocuments = safeDocuments.filter(doc => {
    const matchesSearch = doc.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         doc.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === '' || doc.document_type === selectedType;
    return matchesSearch && matchesType;
  });

  // Group documents by type
  const groupedDocuments = filteredDocuments.reduce((acc, doc) => {
    if (!acc[doc.document_type]) {
      acc[doc.document_type] = [];
    }
    acc[doc.document_type].push(doc);
    return acc;
  }, {});

  // Debug logging
  console.log('=== DOCUMENTS COMPONENT DEBUG ===');
  console.log('Document Types Data:', documentTypesData);
  console.log('Document Types Array:', documentTypes);
  console.log('Document Types Loading:', typesLoading);
  console.log('Document Types Error:', typesError);
  console.log('Grades Data:', gradesData);
  console.log('Grades Array:', grades);
  console.log('Classes Data:', classesData);
  console.log('Classes Array:', classes);
  console.log('User role:', user?.role);
  console.log('Token available:', !!token);
  console.log('Token value:', token ? 'Present' : 'Missing');
  console.log('User data:', user);
  console.log('Documents loading:', isLoading);
  console.log('Documents error:', documentsError);
  console.log('Documents data:', documentsData);
  console.log('Documents array:', documents);
  console.log('Safe documents array:', safeDocuments);
  console.log('Safe documents length:', safeDocuments.length);
  console.log('Safe documents is array:', Array.isArray(safeDocuments));
  console.log('Filtered documents:', filteredDocuments.length);
  console.log('Grouped documents:', Object.keys(groupedDocuments));
  console.log('=== END DEBUG ===');

  const documentIcons = {
    timetable: Calendar,
    past_paper: FileText,
    syllabus: BookOpen,
    assignment: Clipboard,
    notes: BookOpen,
    handbook: BookOpen,
    form: Clipboard,
    other: File
  };

  const handleFileUpload = (e) => {
    e.preventDefault();
    console.log('=== UPLOAD DEBUG START ===');
    console.log('Token available:', !!token);
    console.log('Token value:', token);
    console.log('User:', user);
    console.log('Upload form:', uploadForm);
    
    if (!uploadForm.file || !uploadForm.title || !uploadForm.document_type) {
      toast.error('Please fill in all required fields and select a file');
      return;
    }

    // For students, use their grade/class (single values)
    if (user?.role === 'student') {
      if (!user.grade_id || !user.class_id) {
        toast.error('Your account is missing grade or class assignment');
        return;
      }

      const formData = new FormData();
      formData.append('document', uploadForm.file);
      formData.append('title', uploadForm.title);
      formData.append('description', uploadForm.description);
      formData.append('document_type', uploadForm.document_type);
      formData.append('grade_id', user.grade_id);
      formData.append('class_id', user.class_id);

      console.log('Student upload - single grade/class');
      uploadMutation.mutate(formData);
      return;
    }

    // For admin/teachers, handle multiple selections
    if (uploadForm.grade_ids.length === 0 || uploadForm.class_ids.length === 0) {
      toast.error('Please select at least one grade and one class');
      return;
    }

    console.log('Admin upload - multiple grades/classes');
    console.log('Selected grade_ids:', uploadForm.grade_ids);
    console.log('Selected class_ids:', uploadForm.class_ids);

    // Create multiple upload requests for each grade/class combination
    const uploadPromises = [];
    
    uploadForm.grade_ids.forEach(gradeId => {
      uploadForm.class_ids.forEach(classId => {
        const formData = new FormData();
        formData.append('document', uploadForm.file);
        formData.append('title', uploadForm.title);
        formData.append('description', uploadForm.description);
        formData.append('document_type', uploadForm.document_type);
        formData.append('grade_id', gradeId);
        formData.append('class_id', classId);
        
        uploadPromises.push(
          fetch('/api/documents/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          })
        );
      });
    });

    // Execute all uploads
    Promise.all(uploadPromises)
      .then(responses => {
        const failedUploads = responses.filter(r => !r.ok);
        if (failedUploads.length === 0) {
          queryClient.invalidateQueries(['documents']);
          toast.success(`Document uploaded successfully to ${uploadForm.grade_ids.length} grade(s) and ${uploadForm.class_ids.length} class(es)!`);
          setShowUploadForm(false);
          setUploadForm({
            title: '',
            description: '',
            document_type: '',
            file: null,
            grade_ids: [],
            class_ids: []
          });
        } else {
          toast.error(`Some uploads failed. ${responses.length - failedUploads.length} successful, ${failedUploads.length} failed.`);
        }
      })
      .catch(error => {
        console.error('Upload error:', error);
        toast.error('Upload failed');
      });

    console.log('=== UPLOAD DEBUG END ===');
  };

  const handleDownload = async (documentId, fileName) => {
    try {
      const response = await fetch(`/api/documents/download/${documentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        toast.error('Download failed');
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Download failed');
    }
  };

  const handleDelete = (documentId) => {
    if (window.confirm('Are you sure you want to delete this document?')) {
      deleteMutation.mutate(documentId);
    }
  };

  // Helper functions for multiple selections
  const handleGradeSelection = (gradeId) => {
    const currentSelection = uploadForm.grade_ids;
    const newSelection = currentSelection.includes(gradeId)
      ? currentSelection.filter(id => id !== gradeId)
      : [...currentSelection, gradeId];
    
    setUploadForm({ ...uploadForm, grade_ids: newSelection });
  };

  const handleClassSelection = (classId) => {
    const currentSelection = uploadForm.class_ids;
    const newSelection = currentSelection.includes(classId)
      ? currentSelection.filter(id => id !== classId)
      : [...currentSelection, classId];
    
    setUploadForm({ ...uploadForm, class_ids: newSelection });
  };

  const selectAllGrades = () => {
    const allGradeIds = grades.map(grade => grade.id.toString());
    setUploadForm({ ...uploadForm, grade_ids: allGradeIds });
  };

  const selectAllClasses = () => {
    const allClassIds = classes.map(cls => cls.id.toString());
    setUploadForm({ ...uploadForm, class_ids: allClassIds });
  };

  const clearAllSelections = () => {
    setUploadForm({ ...uploadForm, grade_ids: [], class_ids: [] });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <LoadingSpinner />
          <p className="text-gray-600 mt-4">Loading documents...</p>
        </div>
      </div>
    );
  }
  
  if (documentsError) {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading Documents</h3>
          <p className="text-red-600 mt-1">{documentsError.message}</p>
          {user?.role === 'student' && !user.grade_id && (
            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <h4 className="text-yellow-800 font-medium">Account Setup Required</h4>
              <p className="text-yellow-700 text-sm mt-1">
                Your student account needs to be assigned to a grade to access documents.
              </p>
              <div className="mt-2 text-sm text-gray-600">
                <p><strong>Your current assignments:</strong></p>
                <ul className="ml-4 mt-1">
                  <li>Grade: {user.grade_id ? `Grade ${user.grade_id} (${user.grade_name || 'Unknown'})` : 'Not assigned'}</li>
                  <li>Class: {user.class_id ? `Class ${user.class_id} (${user.class_name || 'Unknown'})` : 'Not assigned'}</li>
                </ul>
              </div>
              <p className="text-yellow-700 text-sm mt-2">
                Please contact your administrator to complete your account setup.
              </p>
            </div>
          )}
          <div className="mt-3">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Document Library</h2>
          <p className="text-gray-600">Access timetables, past papers, and other class materials</p>
        </div>
        {(user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher') && (
          <button
            onClick={() => setShowUploadForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 flex items-center space-x-2"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Document</span>
          </button>
        )}
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Types</option>
          {documentTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Upload Form */}
      {showUploadForm && (
        <div className="bg-white rounded-lg shadow-md p-6 border">
          <h3 className="text-lg font-semibold mb-4">Upload Document</h3>
          <form onSubmit={handleFileUpload} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter document title"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Type *
                </label>
                <select
                  required
                  value={uploadForm.document_type}
                  onChange={(e) => setUploadForm({ ...uploadForm, document_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select type</option>
                  {documentTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                {/* Debug: Show document types count */}
                <p className="text-xs text-gray-500 mt-1">
                  Available types: {documentTypes.length} ({typesLoading ? 'Loading...' : 'Loaded'})
                  {typesError && <span className="text-red-500"> - Error: {typesError.message}</span>}
                </p>
              </div>
            </div>

            {/* Grade and Class selection (for admin/teachers) */}
            {(user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher') && (
              <div className="space-y-4">
                {/* Grade Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Grades * (Select multiple)
                    </label>
                    <div className="space-x-2">
                      <button
                        type="button"
                        onClick={selectAllGrades}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={clearAllSelections}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-3 border border-gray-300 rounded-md max-h-32 overflow-y-auto">
                    {grades.map((grade) => (
                      <label key={grade.id} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={uploadForm.grade_ids.includes(grade.id.toString())}
                          onChange={() => handleGradeSelection(grade.id.toString())}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{grade.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Selected: {uploadForm.grade_ids.length} grade(s)
                  </p>
                </div>

                {/* Class Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Classes * (Select multiple)
                    </label>
                    <button
                      type="button"
                      onClick={selectAllClasses}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Select All Classes
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-3 border border-gray-300 rounded-md max-h-32 overflow-y-auto">
                    {classes.map((cls) => (
                      <label key={cls.id} className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={uploadForm.class_ids.includes(cls.id.toString())}
                          onChange={() => handleClassSelection(cls.id.toString())}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{cls.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Selected: {uploadForm.class_ids.length} class(es)
                  </p>
                </div>

                {/* Selection Summary */}
                {(uploadForm.grade_ids.length > 0 || uploadForm.class_ids.length > 0) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                    <p className="text-sm text-blue-800 font-medium">
                      Document will be uploaded to: {uploadForm.grade_ids.length} grade(s) × {uploadForm.class_ids.length} class(es) = {uploadForm.grade_ids.length * uploadForm.class_ids.length} total assignments
                    </p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={uploadForm.description}
                onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Enter description (optional)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File *
              </label>
              <input
                type="file"
                required
                onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files[0] })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              />
              <p className="text-sm text-gray-500 mt-1">
                Supported formats: PDF, Word, Excel, Images (Max 10MB)
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowUploadForm(false);
                  setUploadForm({
                    title: '',
                    description: '',
                    document_type: '',
                    file: null,
                    grade_ids: [],
                    class_ids: []
                  });
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadMutation.isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {uploadMutation.isLoading ? 'Uploading...' : 
                  (user?.role === 'admin' || user?.role === 'super_admin') && uploadForm.grade_ids.length > 0 && uploadForm.class_ids.length > 0
                    ? `Upload to ${uploadForm.grade_ids.length * uploadForm.class_ids.length} Assignment(s)`
                    : 'Upload'
                }
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Documents List */}
      <div className="space-y-6">
        {user?.role === 'student' && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h4 className="text-blue-800 font-medium">Your Class Information</h4>
            <p className="text-blue-700 text-sm mt-1">
              You are viewing documents for: <strong>{user.grade_name || `Grade ${user.grade_id}`}</strong>
              {user.class_id && (
                <span> - <strong>{user.class_name || `Class ${user.class_id}`}</strong></span>
              )}
            </p>
            {!user.class_id && (
              <p className="text-yellow-700 text-sm mt-1">
                ⚠️ You are not assigned to a specific class, so you can see documents for all classes in your grade.
              </p>
            )}
          </div>
        )}
        
        {Object.keys(groupedDocuments).length === 0 ? (
          <div className="text-center py-12">
            <File className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No documents available</h3>
            <p className="text-gray-500">
              {user?.role === 'student' 
                ? `No documents have been uploaded for ${user.grade_name || `Grade ${user.grade_id}`}${user.class_id ? ` - ${user.class_name || `Class ${user.class_id}`}` : ''} yet.` 
                : 'Upload the first document to get started.'}
            </p>
            {user?.role === 'student' && (
              <p className="text-gray-500 text-sm mt-2">
                Check back later or contact your teacher for more information.
              </p>
            )}
          </div>
        ) : (
          Object.entries(groupedDocuments).map(([type, docs]) => {
            const typeInfo = documentTypes.find(t => t.value === type);
            const IconComponent = documentIcons[type] || File;
            
            return (
              <div key={type} className="bg-white rounded-lg shadow-md">
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center space-x-2">
                    <IconComponent className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {typeInfo?.label || type}
                    </h3>
                    <span className="text-sm text-gray-500">({docs.length})</span>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {docs.map((doc) => (
                      <div key={doc.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="text-sm font-medium text-gray-900 truncate pr-2">
                            {doc.title}
                          </h4>
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleDownload(doc.id, doc.file_name)}
                              className="text-blue-600 hover:text-blue-800"
                              title="Download"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            {(user?.role === 'admin' || user?.role === 'super_admin' || doc.uploaded_by === user?.id) && (
                              <button
                                onClick={() => handleDelete(doc.id)}
                                className="text-red-600 hover:text-red-800"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                        {doc.description && (
                          <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                            {doc.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>{doc.file_size_mb || '0'} MB</span>
                          <span>{new Date(doc.uploaded_at).toLocaleDateString()}</span>
                        </div>
                        {doc.grade_name && doc.class_name && (
                          <div className="mt-2 text-xs text-gray-500">
                            {doc.grade_name} - {doc.class_name}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
  
  } catch (error) {
    console.error('Documents component error:', error);
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Component Error</h3>
          <p className="text-red-600 mt-1">Something went wrong loading the documents page.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }
};

export default Documents;
