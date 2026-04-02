import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { FileText, Download, AlertCircle, FileSpreadsheet, FileImage, Presentation, File } from 'lucide-react';

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
  form:        'bg-purple-100 text-purple-700',
  letter:      'bg-blue-100 text-blue-700',
  assessment:  'bg-orange-100 text-orange-700',
  homework:    'bg-green-100 text-green-700',
  notes:       'bg-yellow-100 text-yellow-700',
  worksheet:   'bg-teal-100 text-teal-700',
  resource:    'bg-indigo-100 text-indigo-700',
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
    parentApi('/documents')
      .then((d) => setDocuments(d.documents || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const types = ['all', ...Array.from(new Set(documents.map(d => d.document_type).filter(Boolean)))];

  const filtered = filter === 'all' ? documents : documents.filter(d => d.document_type === filter);

  const handleDownload = (doc) => {
    const token = localStorage.getItem('parentToken');
    const url = `/api/documents/download/${doc.id}?token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
                      ? 'bg-blue-600 text-white'
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
                    <div className="bg-blue-50 rounded-xl p-3 shrink-0">
                      <Icon className="h-6 w-6 text-blue-600" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-gray-800 font-semibold text-sm leading-tight">{doc.title}</p>
                          {doc.description && (
                            <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{doc.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDownload(doc)}
                          className="shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
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
