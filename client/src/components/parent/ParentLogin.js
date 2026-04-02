import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, BookOpen, ArrowLeft, Phone } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const ParentLogin = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ phone_number: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.post('/auth/login/parent', form);
      const { token, user, children, child, must_change_password } = response.data;

      localStorage.setItem('parentToken',    token);
      localStorage.setItem('parentUser',     JSON.stringify(user));
      localStorage.setItem('parentChildren', JSON.stringify(children || []));
      localStorage.setItem('parentChild',    JSON.stringify(child || children?.[0] || null));

      if (must_change_password) {
        toast('Please set a new password to continue.', { icon: '🔐' });
        navigate('/parent/change-password');
      } else {
        toast.success(`Welcome, ${user.first_name}!`);
        navigate('/parent/dashboard');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed. Check your phone number and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex flex-col">
      <div className="p-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-2xl mb-4">
              <BookOpen className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white">Parent Portal</h1>
            <p className="text-blue-200 mt-2">Harmony Learning Institute</p>
            <p className="text-white/60 text-sm mt-1">Stay connected with your child's education</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Sign in to your account</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Mobile Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="tel"
                    value={form.phone_number}
                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                    placeholder="e.g. 071 167 9620"
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-all"
                    required
                    autoComplete="tel"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Use the phone number you gave the school</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <Link
                    to="/parent/forgot-password"
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Your password"
                    className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-all"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-60 disabled:cursor-not-allowed text-base"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-gray-100 space-y-2">
              <p className="text-center text-xs text-gray-400">
                First time? Contact the school office for your temporary password.
              </p>
              <p className="text-center text-xs text-gray-400">
                Staff or student?{' '}
                <button
                  onClick={() => navigate('/login')}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Use the staff/student portal
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParentLogin;
