import React, { useEffect, useState } from 'react';
import { parentApi } from './ParentPortal';
import { Bell, AlertCircle, User } from 'lucide-react';

const ParentAnnouncements = ({ child }) => {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    parentApi('/announcements')
      .then((d) => setAnnouncements(d.announcements || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notices & Announcements</h1>
        {child && (
          <p className="text-gray-500 text-sm mt-1">School notices for {child.first_name}'s grade and school-wide</p>
        )}
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
      ) : announcements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          No announcements at the moment
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => {
            const isOpen = expanded === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setExpanded(isOpen ? null : a.id)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-50 rounded-xl shrink-0 mt-0.5">
                    <Bell className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-gray-800 font-semibold text-sm leading-snug">{a.title}</p>
                      {a.grade_name && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full shrink-0 font-medium">
                          {a.grade_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-1 text-gray-400 text-xs">
                        <User className="h-3 w-3" />
                        {a.author}
                      </div>
                      <span className="text-gray-300 text-xs">
                        {new Date(a.created_at).toLocaleDateString('en-ZA', {
                          day: 'numeric', month: 'long', year: 'numeric'
                        })}
                      </span>
                    </div>
                    {isOpen ? (
                      <p className="mt-3 text-gray-600 text-sm leading-relaxed whitespace-pre-line">{a.content}</p>
                    ) : (
                      <p className="mt-2 text-gray-400 text-xs line-clamp-2">{a.content}</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ParentAnnouncements;
