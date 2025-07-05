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
    grade_id: '',
    class_id: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('');

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
      let url = '/api/documents/all';
      
      // For students, get documents for their specific grade/class
      if (user?.role === 'student') {
        console.log('=== STUDENT DOCUMENT FETCH DEBUG ===');
        console.log('User grade_id:', user.grade_id);
        console.log('User class_id:', user.class_id);
        console.log('User object:', user);
        
        if (!user.grade_id || !user.class_id) {
          console.error('Student missing grade_id or class_id!');
          throw new Error('Student account is missing grade or class assignment');
        }
        
        url = `/api/documents/grade/${user.grade_id}/class/${user.class_id}`;
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
        throw new Error(`Failed to fetch documents: ${response.status} ${errorText}`);
      }
      const data = await response.json();
      console.log('Documents fetch data:', data);
      return data;
    },
    enabled: !!user && !!token
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
          grade_id: '',
          class_id: ''
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

    // For students, use their grade/class
    let gradeId = uploadForm.grade_id;
    let classId = uploadForm.class_id;
    
    if (user?.role === 'student') {
      gradeId = user.grade_id;
      classId = user.class_id;
    }

    if (!gradeId || !classId) {
      toast.error('Please select grade and class');
      return;
    }

    console.log('Final gradeId:', gradeId);
    console.log('Final classId:', classId);

    const formData = new FormData();
    formData.append('document', uploadForm.file);
    formData.append('title', uploadForm.title);
    formData.append('description', uploadForm.description);
    formData.append('document_type', uploadForm.document_type);
    formData.append('grade_id', gradeId);
    formData.append('class_id', classId);

    console.log('Calling uploadMutation with formData');
    console.log('=== UPLOAD DEBUG END ===');
    uploadMutation.mutate(formData);
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

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
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

  if (isLoading) return <LoadingSpinner />;
  
  if (documentsError) {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading Documents</h3>
          <p className="text-red-600 mt-1">{documentsError.message}</p>
          {user?.role === 'student' && (!user.grade_id || !user.class_id) && (
            <div className="mt-2">
              <p className="text-red-600 text-sm">
                Your student account is missing grade or class assignment. Please contact the administrator.
              </p>
            </div>
          )}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Grade *
                  </label>
                  <select
                    required
                    value={uploadForm.grade_id}
                    onChange={(e) => setUploadForm({ ...uploadForm, grade_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select grade</option>
                    {grades.map((grade) => (
                      <option key={grade.id} value={grade.id}>
                        {grade.name}
                      </option>
                    ))}
                  </select>
                  {/* Debug: Show grades count */}
                  <p className="text-xs text-gray-500 mt-1">
                    Available grades: {grades.length}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Class *
                  </label>
                  <select
                    required
                    value={uploadForm.class_id}
                    onChange={(e) => setUploadForm({ ...uploadForm, class_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select class</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </select>
                  {/* Debug: Show classes count */}
                  <p className="text-xs text-gray-500 mt-1">
                    Available classes: {classes.length}
                  </p>
                </div>
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
                onClick={() => setShowUploadForm(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadMutation.isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {uploadMutation.isLoading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Documents List */}
      <div className="space-y-6">
        {Object.keys(groupedDocuments).length === 0 ? (
          <div className="text-center py-12">
            <File className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No documents available</h3>
            <p className="text-gray-500">
              {user?.role === 'student' 
                ? 'No documents have been uploaded for your class yet.' 
                : 'Upload the first document to get started.'}
            </p>
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
};

export default Documents;
