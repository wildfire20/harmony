import React, { useState, useEffect } from 'react';
import { Upload, Download, File, Trash2, Calendar, User, FileText, BookOpen, Clock, Clipboard, Eye, X, ExternalLink, Search, Grid, List } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usersAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import { toast } from 'react-hot-toast';

const DocumentLibrary = ({ gradeId = null, classId = null }) => {
  const { user, token } = useAuth();
  const [documents, setDocuments] = useState({});
  const [documentTypes, setDocumentTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    document_type: '',
    file: null,
    target_audience: 'everyone' // For admin uploads
  });
  const [viewingDocument, setViewingDocument] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [selectedType, setSelectedType] = useState('all');
  const [assignedGrades, setAssignedGrades] = useState([]);

  // For main documents page (no specific grade/class), use first available assignment for teachers
  const [activeGradeId, setActiveGradeId] = useState(gradeId);
  const [activeClassId, setActiveClassId] = useState(classId);

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

  useEffect(() => {
    fetchDocumentTypes();
    if (user?.role === 'teacher') {
      fetchTeacherAssignments();
    }
    // Delay document fetching until we have grade/class info
  }, []);

  useEffect(() => {
    // Set up active grade/class for document fetching
    if (gradeId && classId) {
      // Specific grade/class provided (e.g., from class page)
      setActiveGradeId(gradeId);
      setActiveClassId(classId);
    } else if (user?.role === 'teacher' && assignedGrades.length > 0) {
      // Teacher on main documents page - use first assignment
      const firstAssignment = assignedGrades[0];
      setActiveGradeId(firstAssignment.grade_id);
      setActiveClassId(firstAssignment.class_id);
    } else if (user?.role === 'student') {
      // Student - use their assigned grade/class
      setActiveGradeId(user.grade_id);
      setActiveClassId(user.class_id);
    } else if (user?.role === 'admin' || user?.role === 'super_admin') {
      // Admin - use grade 1, class 1 as default for fetching (they see all anyway)
      setActiveGradeId(1);
      setActiveClassId(1);
    }
  }, [gradeId, classId, user, assignedGrades]);

  useEffect(() => {
    // Fetch documents when we have active grade/class
    if (activeGradeId && activeClassId) {
      fetchDocuments();
    }
  }, [activeGradeId, activeClassId]);

  const fetchDocuments = async () => {
    if (!activeGradeId || !activeClassId) return;
    
    try {
      const response = await fetch(`/api/documents/grade/${activeGradeId}/class/${activeClassId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDocumentTypes = async () => {
    try {
      const response = await fetch('/api/documents/types', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDocumentTypes(data.document_types);
      }
    } catch (error) {
      console.error('Error fetching document types:', error);
    }
  };

  const fetchTeacherAssignments = async () => {
    try {
      const response = await usersAPI.getTeacherAssignments();
      setAssignedGrades(response.data.assignments || []);
    } catch (error) {
      console.error('Error fetching teacher assignments:', error);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadForm.file || !uploadForm.title || !uploadForm.document_type) {
      alert('Please fill in all required fields and select a file');
      return;
    }

    // For admin uploads, validate target_audience is selected
    if ((user.role === 'admin' || user.role === 'super_admin') && !uploadForm.target_audience) {
      alert('Please select a target audience for the document');
      return;
    }

    // Validate teacher access to this grade/class
    if (user.role === 'teacher') {
      const hasAccess = assignedGrades.some(assignment => 
        assignment.grade_id === parseInt(activeGradeId) && assignment.class_id === parseInt(activeClassId)
      );
      
      if (!hasAccess) {
        alert('You can only upload documents to grades and classes you are assigned to.');
        return;
      }
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('document', uploadForm.file);
    formData.append('title', uploadForm.title);
    formData.append('description', uploadForm.description);
    formData.append('document_type', uploadForm.document_type);
    
    // For admin uploads, use target_audience instead of grade/class
    if (user.role === 'admin' || user.role === 'super_admin') {
      formData.append('target_audience', uploadForm.target_audience);
    } else {
      formData.append('grade_id', activeGradeId);
      formData.append('class_id', activeClassId);
    }

    try {
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (response.ok) {
        await fetchDocuments();
        setShowUploadForm(false);
        setUploadForm({ 
          title: '', 
          description: '', 
          document_type: '', 
          file: null, 
          target_audience: 'everyone' 
        });
      } else {
        const error = await response.json();
        alert(error.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (documentId, fileName) => {
    try {
      console.log('Attempting to download document:', { documentId, fileName });
      
      // Create a temporary link for download with token authentication
      const link = document.createElement('a');
      link.href = `/api/documents/download/${documentId}?token=${encodeURIComponent(token)}`;
      link.download = fileName || 'document';
      link.style.display = 'none';
      
      // Add to DOM, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('Download initiated successfully');
    } catch (error) {
      console.error('Error downloading document:', error);
      alert('Failed to download document. Please try again.');
    }
  };

  const handleDelete = async (documentId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) {
      return;
    }

    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        await fetchDocuments();
      }
    } catch (error) {
      console.error('Error deleting document:', error);
    }
  };

  const handleViewDocument = async (document) => {
    console.log('🔍 Opening document in new tab:', document);
    
    try {
      // Use direct URL approach like TaskDetails.js - create a URL that serves the file directly
      const viewUrl = `/api/documents/view/${document.id}?token=${encodeURIComponent(token)}`;
      
      console.log('📖 View URL:', viewUrl);
      
      // For certain file types, create a blob URL for better browser handling
      const ext = document.filename ? document.filename.split('.').pop().toLowerCase() : '';
      const viewableInBrowser = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt'].includes(ext);
      
      if (viewableInBrowser) {
        try {
          // Fetch the file content first
          const response = await fetch(viewUrl);
          if (response.ok) {
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            // Open the blob URL in a new tab
            const newWindow = window.open(blobUrl, '_blank');
            
            if (newWindow) {
              toast.success('Document opened in new tab');
              
              // Clean up the blob URL after a delay
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
              }, 10000);
            } else {
              toast.error('Popup blocked. Please allow popups for this site.');
              // Fallback to direct URL
              window.open(viewUrl, '_blank');
            }
          } else {
            throw new Error('Failed to fetch document');
          }
        } catch (fetchError) {
          console.log('Fetch failed, falling back to direct URL:', fetchError);
          // Fallback to direct URL approach
          const newWindow = window.open(viewUrl, '_blank');
          if (newWindow) {
            toast.success('Document opened in new tab');
          } else {
            toast.error('Popup blocked. Please allow popups for this site.');
          }
        }
      } else {
        // For non-viewable files, use direct URL
        const newWindow = window.open(viewUrl, '_blank');
        
        if (newWindow) {
          toast.success('Document opened in new tab');
        } else {
          toast.error('Popup blocked. Please allow popups for this site.');
          
          // Try alternative approach by creating a link element
          const a = document.createElement('a');
          a.href = viewUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }
    } catch (error) {
      console.error('View document error:', error);
      toast.error('Failed to open document');
    }
  };

  const getDocumentUrl = (documentId) => {
    return `/api/documents/view/${documentId}?token=${encodeURIComponent(token)}`;
  };

  const getFileExtension = (fileName) => {
    if (!fileName) return '';
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  };

  const isViewableInBrowser = (fileName) => {
    const ext = getFileExtension(fileName);
    // Only include file types that can be reliably viewed in browser without CORS issues
    return ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'txt'].includes(ext);
  };

  const isOfficeDocument = (fileName) => {
    const ext = getFileExtension(fileName);
    return ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext);
  };

  const isDocumentFile = (fileName) => {
    if (!fileName) {
      return false;
    }
    const ext = getFileExtension(fileName);
    // These are document files that should have a view option (even if they download)
    // Ensure we support all common document types including teacher uploads
    return ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
  };

  // Filter documents based on search and type
  const filterDocuments = () => {
    const filteredDocs = {};
    
    Object.entries(documents).forEach(([type, docs]) => {
      if (selectedType === 'all' || selectedType === type) {
        const filtered = docs.filter(doc =>
          doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          doc.description?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        
        if (filtered.length > 0) {
          filteredDocs[type] = filtered;
        }
      }
    });
    
    return filteredDocs;
  };

  const canUpload = user.role === 'teacher' || user.role === 'admin' || user.role === 'super_admin';
  const canDelete = user.role === 'admin' || user.role === 'super_admin';
  const filteredDocuments = filterDocuments();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Important Notice about File Availability */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-yellow-800">File Availability Notice</h3>
            <p className="text-sm text-yellow-700 mt-1">
              Some older documents may be temporarily unavailable due to recent server maintenance. 
              New uploads will work normally. If you need access to specific older documents, please contact an administrator for re-upload.
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Document Library</h2>
          <p className="text-gray-600">Access and manage class materials - Enhanced Version v1.1</p>
        </div>
        
        {canUpload && (
          <button
            onClick={() => setShowUploadForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 shadow-sm"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Document</span>
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              {documentTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm' : 'text-gray-600'}`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow-sm' : 'text-gray-600'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      {showUploadForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Upload Document</h3>
            <button
              onClick={() => {
                setShowUploadForm(false);
                setUploadForm({ 
                  title: '', 
                  description: '', 
                  document_type: '', 
                  file: null, 
                  target_audience: 'everyone' 
                });
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          {(user.role === 'admin' || user.role === 'super_admin') && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                � As an admin, you can upload documents for all users. Select your target audience below.
                <span className="block mt-1 text-xs">
                  Current role: {user.role} | Component version: v1.1
                </span>
              </p>
            </div>
          )}

          {user.role === 'teacher' && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                � You can only upload documents to grades and classes you are assigned to.
                {assignedGrades.length > 0 && (
                  <span className="block mt-1">
                    Your assignments: {assignedGrades.map(a => `${a.grade_name} - ${a.class_name}`).join(', ')}
                  </span>
                )}
                <span className="block mt-1 text-xs">
                  Current role: {user.role} | Component version: v1.1
                </span>
              </p>
            </div>
          )}
          
          <form onSubmit={handleFileUpload} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title <span className="text-red-500">*</span>
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
                  Document Type <span className="text-red-500">*</span>
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
              </div>
            </div>

            {/* Admin Target Audience Selection */}
            {(user.role === 'admin' || user.role === 'super_admin') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Audience <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={uploadForm.target_audience}
                  onChange={(e) => setUploadForm({ ...uploadForm, target_audience: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select target audience</option>
                  <option value="everyone">Everyone (All Users)</option>
                  <option value="student">Students Only</option>
                  <option value="staff">Staff Only (Teachers & Admins)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Choose who can access this document
                </p>
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
                File <span className="text-red-500">*</span>
              </label>
              <input
                type="file"
                required
                onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files[0] })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              />
              <p className="text-xs text-gray-500 mt-1">
                Supported formats: PDF, Word, Excel, Images (Max 10MB)
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                type="submit"
                disabled={uploading}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                {uploading ? <LoadingSpinner size="sm" /> : <Upload className="h-4 w-4" />}
                <span>{uploading ? 'Uploading...' : 'Upload'}</span>
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setShowUploadForm(false);
                  setUploadForm({ 
                    title: '', 
                    description: '', 
                    document_type: '', 
                    file: null, 
                    target_audience: 'everyone' 
                  });
                }}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Documents */}
      {Object.keys(filteredDocuments).length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <File className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm || selectedType !== 'all' ? 'No documents found' : 'No documents available'}
          </h3>
          <p className="text-gray-600">
            {searchTerm || selectedType !== 'all' 
              ? 'Try adjusting your search or filter criteria'
              : canUpload ? 'Upload the first document to get started.' : 'Documents will appear here when uploaded.'
            }
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(filteredDocuments).map(([type, docs]) => {
            const typeInfo = documentTypes.find(t => t.value === type) || { label: type, icon: 'file' };
            const IconComponent = documentIcons[type] || File;

            return (
              <div key={type} className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center space-x-3">
                    <IconComponent className="h-6 w-6 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">{typeInfo.label}</h3>
                    <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded-full">
                      {docs.length}
                    </span>
                  </div>
                </div>

                {viewMode === 'grid' ? (
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {docs.map((doc) => (
                      <div key={doc.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-gray-900 truncate">
                              {doc.title}
                            </h4>
                            {doc.description && (
                              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                {doc.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                          <div className="flex items-center space-x-1">
                            <User className="h-3 w-3" />
                            <span>{doc.uploaded_by_first_name} {doc.uploaded_by_last_name}</span>
                          </div>
                          <span>{doc.file_size_mb} MB</span>
                        </div>

                        <div className="flex items-center space-x-2">
                          {isDocumentFile(doc.filename) && (
                            <button
                              onClick={() => handleViewDocument(doc)}
                              className="flex-1 bg-blue-50 text-blue-600 px-3 py-2 rounded text-sm hover:bg-blue-100 transition-colors flex items-center justify-center space-x-1"
                              title={isViewableInBrowser(doc.filename) ? "View in browser" : "View/Download document"}
                            >
                              <Eye className="h-3 w-3" />
                              <span>View</span>
                            </button>
                          )}
                          
                          <button
                            onClick={() => handleDownload(doc.id, doc.filename)}
                            className="flex-1 bg-gray-50 text-gray-600 px-3 py-2 rounded text-sm hover:bg-gray-100 transition-colors flex items-center justify-center space-x-1"
                            title="Download"
                          >
                            <Download className="h-3 w-3" />
                            <span>Download</span>
                          </button>
                          
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(doc.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {docs.map((doc) => (
                      <div key={doc.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {doc.title}
                          </h4>
                          {doc.description && (
                            <p className="text-sm text-gray-600 mt-1 truncate">
                              {doc.description}
                            </p>
                          )}
                          <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                            <div className="flex items-center space-x-1">
                              <User className="h-3 w-3" />
                              <span>{doc.uploaded_by_first_name} {doc.uploaded_by_last_name}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Calendar className="h-3 w-3" />
                              <span>{new Date(doc.uploaded_at).toLocaleDateString()}</span>
                            </div>
                            <span>{doc.file_size_mb} MB</span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
                          {isDocumentFile(doc.filename) && (
                            <button
                              onClick={() => handleViewDocument(doc)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              title={isViewableInBrowser(doc.filename) ? "View in browser" : "View/Download document"}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          
                          <button
                            onClick={() => handleDownload(doc.id, doc.filename)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(doc.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Document Viewer Modal */}
      {viewingDocument && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-6xl max-h-[90vh] w-full mx-4 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{viewingDocument.title}</h3>
                <p className="text-sm text-gray-600">{viewingDocument.description}</p>
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href={getDocumentUrl(viewingDocument.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => handleDownload(viewingDocument.id, viewingDocument.filename)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewingDocument(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-hidden">
              {/* If we have a signed URL for viewable files, show the content */}
              {viewingDocument.signedViewUrl && isViewableInBrowser(viewingDocument.filename) ? (
                <div className="h-full">
                  {getFileExtension(viewingDocument.filename) === 'pdf' ? (
                    <iframe
                      src={viewingDocument.signedViewUrl}
                      className="w-full h-full"
                      title={viewingDocument.title}
                      onError={(e) => {
                        console.error('Failed to load PDF in iframe');
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                      }}
                    />
                  ) : ['jpg', 'jpeg', 'png', 'gif'].includes(getFileExtension(viewingDocument.filename)) ? (
                    <div className="h-full p-4 overflow-auto bg-gray-50 flex items-center justify-center">
                      <img 
                        src={viewingDocument.signedViewUrl}
                        alt={viewingDocument.title}
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => {
                          console.error('Failed to load image');
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'block';
                        }}
                      />
                    </div>
                  ) : getFileExtension(viewingDocument.filename) === 'txt' ? (
                    <iframe
                      src={viewingDocument.signedViewUrl}
                      className="w-full h-full border-0"
                      title={viewingDocument.title}
                      onError={(e) => {
                        console.error('Failed to load text file');
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                      }}
                    />
                  ) : null}
                </div>
              ) : (
                /* Default download interface for non-viewable files or when viewing fails */
                <div className="h-full flex items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <div className="mb-6">
                      {getFileExtension(viewingDocument.filename) === 'pdf' ? (
                        <FileText className="h-16 w-16 text-red-500 mx-auto" />
                      ) : ['jpg', 'jpeg', 'png', 'gif'].includes(getFileExtension(viewingDocument.filename)) ? (
                        <FileText className="h-16 w-16 text-green-500 mx-auto" />
                      ) : isOfficeDocument(viewingDocument.filename) ? (
                        <FileText className="h-16 w-16 text-blue-500 mx-auto" />
                      ) : (
                        <File className="h-16 w-16 text-gray-500 mx-auto" />
                      )}
                    </div>
                    
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">{viewingDocument.title}</h3>
                    <p className="text-sm text-gray-600 mb-2">{viewingDocument.filename}</p>
                    {viewingDocument.description && (
                      <p className="text-sm text-gray-500 mb-6">{viewingDocument.description}</p>
                    )}
                    
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600">
                        {getFileExtension(viewingDocument.filename) === 'pdf' ? 
                          'PDF documents can be downloaded and viewed in your browser or PDF reader.' :
                          isOfficeDocument(viewingDocument.filename) ?
                          'Office documents need to be downloaded to view their contents.' :
                          ['jpg', 'jpeg', 'png', 'gif'].includes(getFileExtension(viewingDocument.filename)) ?
                          'Image files can be downloaded and viewed.' :
                          'Download this document to view its contents.'
                        }
                      </p>
                      
                      <button
                        onClick={() => handleDownload(viewingDocument.id, viewingDocument.filename)}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 mx-auto"
                      >
                        <Download className="h-5 w-5" />
                        <span>Download Document</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentLibrary;
