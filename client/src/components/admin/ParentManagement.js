import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { UserPlus, Trash2, Edit2, Search, Users, Eye, EyeOff, AlertCircle, X, RefreshCw } from 'lucide-react';

const ParentManagement = () => {
  const [parents, setParents] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [studentSearch, setStudentSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingParent, setEditingParent] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterText, setFilterText] = useState('');

  const emptyForm = { first_name: '', last_name: '', email: '', password: '', student_id: '' };
  const [form, setForm] = useState(emptyForm);

  const loadParents = async () => {
    try {
      const res = await api.get('/parent/admin/list');
      setParents(res.data.parents || []);
    } catch (e) {
      toast.error('Failed to load parent accounts');
    } finally {
      setLoading(false);
    }
  };

  const searchStudents = async () => {
    if (!studentSearch.trim()) return;
    try {
      const res = await api.get(`/admin/students?search=${encodeURIComponent(studentSearch)}&limit=10`);
      setStudents(res.data.students || []);
    } catch {
      toast.error('Student search failed');
    }
  };

  useEffect(() => { loadParents(); }, []);
  useEffect(() => {
    if (studentSearch.length >= 2) {
      const t = setTimeout(searchStudents, 400);
      return () => clearTimeout(t);
    } else {
      setStudents([]);
    }
  }, [studentSearch]);

  const openCreate = () => { setEditingParent(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (p) => {
    setEditingParent(p);
    setForm({
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email,
      password: '',
      student_id: p.child_id || '',
    });
    setStudentSearch(p.child_name || '');
    setStudents(p.child_id ? [{
      id: p.child_id,
      first_name: p.child_name?.split(' ')[0] || '',
      last_name: p.child_name?.split(' ').slice(1).join(' ') || '',
      student_number: p.child_student_number,
    }] : []);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.student_id) return toast.error('Please select a student');
    if (!editingParent && !form.password) return toast.error('Password is required');

    setSubmitting(true);
    try {
      if (editingParent) {
        await api.put(`/parent/admin/${editingParent.id}`, form);
        toast.success('Parent account updated');
      } else {
        await api.post('/parent/admin/create', form);
        toast.success('Parent account created');
      }
      setShowForm(false);
      setForm(emptyForm);
      setStudentSearch('');
      setStudents([]);
      loadParents();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (parent) => {
    if (!window.confirm(`Delete account for ${parent.first_name} ${parent.last_name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/parent/admin/${parent.id}`);
      toast.success('Parent account deleted');
      loadParents();
    } catch {
      toast.error('Failed to delete parent account');
    }
  };

  const filtered = parents.filter((p) => {
    const q = filterText.toLowerCase();
    return (
      p.first_name?.toLowerCase().includes(q) ||
      p.last_name?.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.child_name?.toLowerCase().includes(q) ||
      p.child_student_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Parent Accounts</h2>
          <p className="text-gray-500 text-sm mt-0.5">Create parent portal logins linked to a student</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm text-sm"
        >
          <UserPlus className="h-4 w-4" />
          Add Parent Account
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search parents or students…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
        />
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{editingParent ? 'Edit Parent Account' : 'New Parent Account'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                  <input
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
                  <input
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email Address *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Password {editingParent && <span className="text-gray-400">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    required={!editingParent}
                    placeholder={editingParent ? 'Leave blank to keep unchanged' : 'Set a password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Student search */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Linked Student *</label>
                {form.student_id ? (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    <span className="text-emerald-700 text-sm font-medium flex-1">
                      {students.find((s) => s.id === +form.student_id)?.first_name || ''}{' '}
                      {students.find((s) => s.id === +form.student_id)?.last_name || ''}{' '}
                      ({students.find((s) => s.id === +form.student_id)?.student_number || form.student_id})
                    </span>
                    <button
                      type="button"
                      onClick={() => { setForm({ ...form, student_id: '' }); setStudentSearch(''); setStudents([]); }}
                      className="text-emerald-600 hover:text-emerald-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Search by name or student number…"
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    {students.length > 0 && (
                      <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        {students.slice(0, 6).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setForm({ ...form, student_id: s.id })}
                            className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0 text-left"
                          >
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                              {s.first_name?.[0]}{s.last_name?.[0]}
                            </div>
                            <div>
                              <p className="text-gray-800 text-sm font-medium">{s.first_name} {s.last_name}</p>
                              <p className="text-gray-400 text-xs">{s.student_number}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {studentSearch.length >= 2 && students.length === 0 && (
                      <p className="text-gray-400 text-xs mt-1 ml-1">No students found</p>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors text-sm disabled:opacity-60"
                >
                  {submitting ? 'Saving…' : editingParent ? 'Update' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">
            {parents.length === 0 ? 'No parent accounts yet' : 'No results match your search'}
          </p>
          {parents.length === 0 && (
            <p className="text-gray-400 text-xs mt-1">Click "Add Parent Account" to get started</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="hidden sm:grid grid-cols-4 text-xs font-semibold text-gray-400 uppercase px-5 py-3 border-b border-gray-50">
            <span>Parent</span>
            <span>Email</span>
            <span>Linked Child</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map((p) => (
              <div key={p.id} className="flex flex-col sm:grid sm:grid-cols-4 gap-2 sm:gap-0 items-start sm:items-center px-5 py-4">
                <div>
                  <p className="text-gray-800 font-semibold text-sm">{p.first_name} {p.last_name}</p>
                  <p className="text-gray-400 text-xs sm:hidden">{p.email}</p>
                </div>
                <p className="hidden sm:block text-gray-500 text-sm">{p.email}</p>
                <div>
                  {p.child_name ? (
                    <>
                      <p className="text-gray-700 text-sm font-medium">{p.child_name}</p>
                      <p className="text-gray-400 text-xs">{p.child_student_number} &bull; {p.child_grade}</p>
                    </>
                  ) : (
                    <span className="text-amber-500 text-xs flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Not linked
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <button
                    onClick={() => openEdit(p)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg font-medium transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-gray-400 text-xs text-center">
        Parents log in at <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">/parent/login</span> using their email and password
      </p>
    </div>
  );
};

export default ParentManagement;
