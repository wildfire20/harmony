import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ShieldCheck } from 'lucide-react';

const ParentForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    } catch (_) { /* Deliberately do not disclose account existence. */ }
    setSubmitted(true); setLoading(false);
  };

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
             {!submitted ? <form onSubmit={submit} className="text-left"><p className="text-gray-600 text-sm leading-6 mb-5">Enter your email address. If an account matches, we’ll send a secure reset link.</p><label className="block text-sm font-medium text-gray-700 mb-1">Email address</label><input required value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" className="w-full px-4 py-3 border rounded-xl mb-4" /><button disabled={loading} className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl disabled:opacity-60">{loading ? 'Submitting…' : 'Send reset link'}</button></form> : <><p className="text-gray-600 text-sm leading-6 mb-6">If an account matches that information, a reset link will arrive shortly. For your security, we never reveal whether an account exists.</p><button onClick={() => navigate('/parent/login')} className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl">Return to Parent Login</button></>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParentForgotPassword;
