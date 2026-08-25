import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ShieldCheck } from 'lucide-react';

const ParentForgotPassword = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex flex-col">
      <div className="p-4">
        <button
          onClick={() => navigate('/parent/login')}
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Login
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-2xl mb-4">
              <BookOpen className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Reset Password</h1>
            <p className="text-blue-200 mt-1 text-sm">Harmony Learning Institute – Parent Portal</p>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-5">
              <ShieldCheck className="h-8 w-8 text-blue-700" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-3">Password assistance</h2>
            <p className="text-gray-600 text-sm leading-6 mb-6">
              For your security, password recovery is handled by Harmony Learning Institute administration.
              Please contact the school office for assistance with your Parent Portal password.
            </p>
            <button
              onClick={() => navigate('/parent/login')}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all"
            >
              Return to Parent Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParentForgotPassword;
