import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { FileText, Download, Eye, AlertCircle, FileSpreadsheet, FileImage, Presentation, File } from 'lucide-react';

const TYPE_LABELS = {
  homework:    'Homework',
  notes:       'Notes',
  worksheet:   'Worksheet',
  resource:    'Resource',
  assessment:  'Assessment',
  form:        'Form',
  letter:      'Letter',
  other:       'Other',
};

const TYPE_COLORS = {
   form:        'bg-[#fcebea] text-[#ad5147]',
   letter:      'bg-[#e8f1ef] text-[#176b73]',
  assessment:  'bg-orange-100 text-orange-700',
  homework:    'bg-green-100 text-green-700',
  notes:       'bg-yellow-100 text-yellow-700',
  worksheet:   'bg-teal-100 text-teal-700',
   resource:    'bg-[#edf2f2] text-[#617487]',
  other:       'bg-gray-100 text-gray-600',
};

const fileIcon = (name = '') => {
  const ext = name.split('.').pop().toLowerCase();
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return FileImage;
  if (['ppt', 'pptx'].includes(ext)) return Presentation;
  return FileText;
};

const formatBytes = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ParentDocuments = ({ child }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!child?.id) return;
    parentApi(`/documents?child_id=${encodeURIComponent(child?.id || '')}`)
      .then((d) => setDocuments(d.documents || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [child?.id]);

  const types = ['all', ...Array.from(new Set(documents.map(d => d.document_type).filter(Boolean)))];

  const filtered = filter === 'all' ? documents : documents.filter(d => d.document_type === filter);

  const fetchDocument = async (path) => {
    const token = sessionStorage.getItem('parentToken');
    const response = await fetch(path, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Unable to retrieve document');
    return response.blob();
  };

  const handleDownload = async (doc) => {
    try {
       const blob = await fetchDocument(`/api/parent/documents/${doc.id}/download?child_id=${encodeURIComponent(child?.id || '')}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.file_name || doc.filename || 'document';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleView = async (doc) => {
    const opened = window.open('about:blank', '_blank');
    if (!opened) {
      return setError('Please allow popups to view this document');
    }
    opened.opener = null;
    try {
       const blob = await fetchDocument(`/api/parent/documents/${doc.id}/view?child_id=${encodeURIComponent(child?.id || '')}`);
      const url = URL.createObjectURL(blob);
      opened.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      opened.close();
      setError(err.message);
    }
  };

  const isViewable = (name = '') => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-500 text-sm mt-1">
          Forms, letters, and notices shared by the school
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2c7475]" />
        </div>
      ) : (
        <>
          {types.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    filter === t
                       ? 'bg-[#176b73] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t === 'all' ? 'All' : (TYPE_LABELS[t] || t.charAt(0).toUpperCase() + t.slice(1))}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
              <File className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 text-sm font-medium">No documents available yet</p>
              <p className="text-gray-300 text-xs mt-1">
                The school will share forms, letters, and notices here
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((doc) => {
                const Icon = fileIcon(doc.original_file_name || '');
                const typeColor = TYPE_COLORS[doc.document_type] || TYPE_COLORS.other;
                const typeLabel = TYPE_LABELS[doc.document_type] || (doc.document_type || 'Document');
                const date = doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString('en-ZA', {
                  day: 'numeric', month: 'short', year: 'numeric'
                }) : '';

                return (
                  <div
                    key={doc.id}
                    className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-4 shadow-sm"
                  >
                     <div className="bg-[#e8f1ef] rounded-xl p-3 shrink-0">
                       <Icon className="h-6 w-6 text-[#176b73]" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-gray-800 font-semibold text-sm leading-tight">{doc.title}</p>
                          {doc.description && (
                            <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{doc.description}</p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {isViewable(doc.original_file_name) && (
                            <button
                              onClick={() => handleView(doc)}
                              className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </button>
                          )}
                          <button
                            onClick={() => handleDownload(doc)}
                               className="flex items-center gap-1.5 bg-[#176b73] hover:bg-[#125b62] text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Save
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColor}`}>
                          {typeLabel}
                        </span>
                        {doc.original_file_name && (
                          <span className="text-gray-400 text-xs truncate max-w-36">
                            {doc.original_file_name}
                          </span>
                        )}
                        {doc.file_size && (
                          <span className="text-gray-400 text-xs">{formatBytes(doc.file_size)}</span>
                        )}
                        <span className="text-gray-400 text-xs ml-auto">{date}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ParentDocuments;
