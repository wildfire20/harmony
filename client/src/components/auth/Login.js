import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, GraduationCap, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../common/LoadingSpinner';
import HarmonyLogo from '../common/HarmonyLogo';

const Login = () => {
  const [userType, setUserType] = useState('student');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const onSubmit = async (data) => {
    console.log('Current userType:', userType); // Debug log
    setLoading(true);
    try {
      const result = await login(data, userType);
      if (result.success) {
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Login error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-6">
            <HarmonyLogo size={80} showText={false} />
          </div>
          <h2 className="text-3xl font-bold text-gray-900">
            Harmony Learning Institute
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to your account (Current: {userType})
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-white py-8 px-4 shadow-lg sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
            {/* User Type Selection Tabs */}
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              <button
                type="button"
                onClick={() => {
                  console.log('Student button clicked');
                  setUserType('student');
                }}
                className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center space-x-2 transition-all duration-200 ${
                  userType === 'student'
                    ? 'bg-pink-500 hover:bg-pink-600 text-white border-pink-500'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200'
                }`}
                style={{
                  backgroundColor: userType === 'student' ? '#ec4899' : '#f9fafb',
                  color: userType === 'student' ? 'white' : '#374151'
                }}
              >
                <GraduationCap className="h-4 w-4" />
                <span>Student</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log('Staff button clicked');
                  setUserType('staff');
                }}
                className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center space-x-2 transition-all duration-200 ${
                  userType === 'staff'
                    ? 'bg-blue-500 hover:bg-blue-600 text-white border-blue-500'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200'
                }`}
                style={{
                  backgroundColor: userType === 'staff' ? '#3b82f6' : '#f9fafb',
                  color: userType === 'staff' ? 'white' : '#374151'
                }}
              >
                <Users className="h-4 w-4" />
                <span>Staff</span>
              </button>
            </div>

            {/* Username/Email Field */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                {userType === 'student' ? 'Student Number' : 'Email Address'}
              </label>
              <input
                id="username"
                name="username"
                type={userType === 'student' ? 'text' : 'email'}
                autoComplete={userType === 'student' ? 'username' : 'email'}
                required
                {...register(userType === 'student' ? 'student_number' : 'email', {
                  required: `${userType === 'student' ? 'Student number' : 'Email'} is required`,
                })}
                className={`mt-1 block w-full px-3 py-2 border ${
                  errors[userType === 'student' ? 'student_number' : 'email'] 
                    ? 'border-red-300' 
                    : 'border-gray-300'
                } rounded-md shadow-sm placeholder-gray-400 focus:outline-none ${
                  userType === 'student' 
                    ? 'focus:ring-pink-500 focus:border-pink-500' 
                    : 'focus:ring-blue-500 focus:border-blue-500'
                }`}
                placeholder={userType === 'student' ? 'Enter your student number' : 'Enter your email address'}
              />
              {errors[userType === 'student' ? 'student_number' : 'email'] && (
                <p className="mt-1 text-sm text-red-600">
                  {errors[userType === 'student' ? 'student_number' : 'email']?.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  {...register('password', {
                    required: 'Password is required',
                    minLength: {
                      value: 6,
                      message: 'Password must be at least 6 characters',
                    },
                  })}
                  className={`mt-1 block w-full px-3 py-2 pr-10 border ${
                    errors.password ? 'border-red-300' : 'border-gray-300'
                  } rounded-md shadow-sm placeholder-gray-400 focus:outline-none ${
                    userType === 'student' 
                      ? 'focus:ring-pink-500 focus:border-pink-500' 
                      : 'focus:ring-blue-500 focus:border-blue-500'
                  }`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            {/* Sign In Button */}
            <div>
              <button
                type="submit"
                disabled={loading}
                className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  userType === 'student' 
                    ? 'bg-pink-500 hover:bg-pink-600 focus:ring-pink-500' 
                    : 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>

            {/* Demo credentials info */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="text-sm font-medium text-blue-800 mb-2">Demo Credentials</h3>
              <div className="text-xs text-blue-700 space-y-1">
                <p><strong>Super Admin:</strong> admin@harmonylearning.edu / admin123</p>
                <p><strong>Student:</strong> Use your student number for both username and password</p>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
