import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Shield, Eye, EyeOff, CheckCircle, BookOpen } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const STEPS = { PHONE: 'phone', OTP: 'otp', NEW_PASSWORD: 'new_password', DONE: 'done' };

const ParentForgotPassword = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.PHONE);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devOtp, setDevOtp] = useState(null);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/parent/forgot-password', { phone_number: phone });
      if (res.data.dev_otp) {
        setDevOtp(res.data.dev_otp);
        toast('SMS not configured – show the code to the parent.', { icon: '⚠️', duration: 8000 });
      } else {
        toast.success('A reset code has been sent via SMS.');
      }
      setStep(STEPS.OTP);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/parent/verify-otp', { phone_number: phone, otp });
      setResetToken(res.data.reset_token);
      setStep(STEPS.NEW_PASSWORD);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid or expired code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (newPassword.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }
    setLoading(true);
    try {
      await api.post('/auth/parent/reset-password', {
        phone_number: phone,
        reset_token: resetToken,
        new_password: newPassword,
      });
      setStep(STEPS.DONE);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Password reset failed. Please start again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex flex-col">
      <div className="p-4">
        <button
          onClick={() => step === STEPS.PHONE ? navigate('/parent/login') : setStep(STEPS.PHONE)}
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          {step === STEPS.PHONE ? 'Back to Login' : 'Back'}
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

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Step indicator */}
            {step !== STEPS.DONE && (
              <div className="flex items-center gap-2 mb-6">
                {[STEPS.PHONE, STEPS.OTP, STEPS.NEW_PASSWORD].map((s, i) => (
                  <React.Fragment key={s}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      step === s ? 'bg-blue-600 text-white' :
                      [STEPS.OTP, STEPS.NEW_PASSWORD].indexOf(step) > i ? 'bg-emerald-500 text-white' :
                      'bg-gray-100 text-gray-400'
                    }`}>
                      {[STEPS.OTP, STEPS.NEW_PASSWORD].indexOf(step) > i ? '✓' : i + 1}
                    </div>
                    {i < 2 && <div className={`flex-1 h-0.5 ${[STEPS.OTP, STEPS.NEW_PASSWORD].indexOf(step) > i ? 'bg-emerald-400' : 'bg-gray-100'}`} />}
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Step 1: Enter phone */}
            {step === STEPS.PHONE && (
              <form onSubmit={handleSendOtp} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-1">Enter your phone number</h2>
                  <p className="text-gray-500 text-sm mb-4">We'll send a 6-digit reset code to your mobile number.</p>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 071 167 9620"
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-60"
                >
                  {loading ? 'Sending…' : 'Send Reset Code'}
                </button>
              </form>
            )}

            {/* Step 2: Enter OTP */}
            {step === STEPS.OTP && (
              <form onSubmit={handleVerifyOtp} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-1">Enter the reset code</h2>
                  <p className="text-gray-500 text-sm mb-4">
                    A 6-digit code was sent to <span className="font-medium text-gray-700">{phone}</span>.
                    It expires in 15 minutes.
                  </p>

                  {devOtp && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                      <p className="text-amber-800 text-xs font-semibold mb-0.5">SMS not configured</p>
                      <p className="text-amber-700 text-sm">Show this code to the parent: <span className="font-mono font-bold text-lg tracking-widest">{devOtp}</span></p>
                    </div>
                  )}

                  <label className="block text-sm font-medium text-gray-700 mb-1.5">6-Digit Code</label>
                  <div className="relative">
                    <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm font-mono tracking-widest text-center text-lg"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-60"
                >
                  {loading ? 'Verifying…' : 'Verify Code'}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep(STEPS.PHONE); setOtp(''); setDevOtp(null); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Didn't receive it? Start over
                </button>
              </form>
            )}

            {/* Step 3: New password */}
            {step === STEPS.NEW_PASSWORD && (
              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-1">Create a new password</h2>
                  <p className="text-gray-500 text-sm mb-4">Choose a password that is at least 6 characters long.</p>
                </div>
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
                <button
                  type="submit"
                  disabled={loading || newPassword !== confirmPassword || newPassword.length < 6}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-60"
                >
                  {loading ? 'Saving…' : 'Set New Password'}
                </button>
              </form>
            )}

            {/* Done */}
            {step === STEPS.DONE && (
              <div className="text-center py-4 space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full">
                  <CheckCircle className="h-8 w-8 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-800">Password Reset!</h2>
                <p className="text-gray-500 text-sm">Your new password has been saved. You can now log in.</p>
                <button
                  onClick={() => navigate('/parent/login')}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all"
                >
                  Go to Login
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParentForgotPassword;
