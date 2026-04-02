import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, BookOpen, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const ParentForceChangePassword = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const user = JSON.parse(localStorage.getItem('parentUser') || 'null');

  useEffect(() => {
    if (!localStorage.getItem('parentToken')) {
      navigate('/parent/login');
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) return toast.error('Password must be at least 6 characters');
    if (newPassword !== confirmPassword) return toast.error('Passwords do not match');

    setLoading(true);
    try {
      const token = localStorage.getItem('parentToken');
      const res = await fetch('/api/parent/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      // Update stored user
      if (user) {
        localStorage.setItem('parentUser', JSON.stringify({ ...user, must_change_password: false }));
      }
      setDone(true);
    } catch (err) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-2xl mb-4">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Parent Portal</h1>
          <p className="text-blue-200 text-sm mt-1">Harmony Learning Institute</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {!done ? (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                  <Lock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">Create your password</h2>
                  <p className="text-gray-500 text-xs">
                    {user?.first_name ? `Welcome, ${user.first_name}! ` : ''}
                    For your security, please set a new password before continuing.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                      required
                      minLength={6}
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                    required
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
                  )}
                </div>

                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-blue-700 text-xs font-medium mb-1">Password tips:</p>
                  <ul className="text-blue-600 text-xs space-y-0.5">
                    <li>• At least 6 characters long</li>
                    <li>• Mix letters and numbers for stronger security</li>
                    <li>• Don't share it with anyone</li>
                  </ul>
                </div>

                <button
                  type="submit"
                  disabled={loading || newPassword !== confirmPassword || newPassword.length < 6}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-60"
                >
                  {loading ? 'Saving…' : 'Set My Password'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-4 space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800">All set!</h2>
              <p className="text-gray-500 text-sm">Your password has been saved. Welcome to the parent portal.</p>
              <button
                onClick={() => navigate('/parent/dashboard')}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all"
              >
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ParentForceChangePassword;
