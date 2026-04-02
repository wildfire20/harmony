import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, BookOpen, ArrowRight, Copy, CheckCircle, LogIn, HelpCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const ParentWelcome = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // null | { found, already_set, first_name, temp_password }
  const [copied, setCopied] = useState(false);

  const handleLookup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/parent/welcome-password?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      setResult(data);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const copyPassword = () => {
    if (result?.temp_password) {
      navigator.clipboard.writeText(result.temp_password);
      setCopied(true);
      toast.success('Password copied!');
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex flex-col">
      {/* Top bar */}
      <div className="p-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          Harmony Learning Institute
        </button>
        <button
          onClick={() => navigate('/parent/login')}
          className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors"
        >
          Already have a password?
          <LogIn className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-md space-y-4">

          {/* Hero */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur-sm rounded-2xl mb-4">
              <BookOpen className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white">Welcome, Parent!</h1>
            <p className="text-blue-200 mt-2">Let's get you into the Parent Portal</p>
          </div>

          {/* Step card */}
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* How it works banner */}
            <div className="bg-blue-50 border-b border-blue-100 px-6 py-4">
              <p className="text-blue-800 text-sm font-semibold mb-2">How to get started:</p>
              <div className="flex flex-col gap-2">
                {[
                  'Enter the phone number you gave the school below',
                  'Your temporary password will appear on screen',
                  'Use it to log in, then set your own password',
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {i + 1}
                    </div>
                    <p className="text-blue-700 text-sm">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6">
              {!result ? (
                /* Phone lookup form */
                <form onSubmit={handleLookup} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Your Mobile Phone Number
                    </label>
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
                        autoComplete="tel"
                      />
                    </div>
                    <p className="text-gray-400 text-xs mt-1">
                      This is the number you gave to the school when enrolling your child.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !phone.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-60 text-base"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Looking up…
                      </>
                    ) : (
                      <>
                        Find My Account
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : result.found === false ? (
                /* Not found */
                <div className="text-center space-y-4 py-2">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-100 rounded-full">
                    <HelpCircle className="h-7 w-7 text-amber-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 mb-1">No account found</p>
                    <p className="text-gray-500 text-sm">
                      We couldn't find an account for <span className="font-medium">{phone}</span>.
                      Please double-check the number, or contact the school office for assistance.
                    </p>
                  </div>
                  <button
                    onClick={() => { setResult(null); setPhone(''); }}
                    className="text-blue-600 text-sm hover:underline font-medium"
                  >
                    Try a different number
                  </button>
                </div>
              ) : result.already_set ? (
                /* Account exists but password already changed */
                <div className="text-center space-y-4 py-2">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full">
                    <CheckCircle className="h-7 w-7 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 mb-1">You're already set up!</p>
                    <p className="text-gray-500 text-sm">
                      Your account is active and you've already created your own password.
                      Head over to the login page to sign in.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/parent/login')}
                    className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all"
                  >
                    Go to Login
                  </button>
                  <p className="text-xs text-gray-400">
                    Forgot your password?{' '}
                    <button onClick={() => navigate('/parent/forgot-password')} className="text-blue-600 hover:underline">
                      Reset it here
                    </button>
                  </p>
                </div>
              ) : (
                /* Password revealed */
                <div className="space-y-5">
                  <div className="text-center">
                    <p className="text-gray-600 text-sm mb-1">
                      Hi <span className="font-semibold text-gray-800">{result.first_name}</span>! Here's your temporary password:
                    </p>
                  </div>

                  {/* Big password display */}
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200 rounded-2xl p-5 text-center">
                    <p className="text-xs font-semibold text-blue-500 uppercase tracking-widest mb-2">Your Temporary Password</p>
                    <p className="text-3xl font-bold text-blue-800 tracking-wide font-mono break-all">
                      {result.temp_password}
                    </p>
                    <button
                      onClick={copyPassword}
                      className={`mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                        copied
                          ? 'bg-emerald-500 text-white'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {copied ? (
                        <><CheckCircle className="h-3.5 w-3.5" /> Copied!</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5" /> Copy Password</>
                      )}
                    </button>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <p className="text-amber-800 text-xs font-semibold mb-1">Important:</p>
                    <ul className="text-amber-700 text-xs space-y-1">
                      <li>• Use this password to log in once</li>
                      <li>• You'll be asked to create your own password immediately after</li>
                      <li>• This temporary password stops working after you set your own</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => navigate('/parent/login')}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all text-base"
                  >
                    Go to Login
                    <LogIn className="h-4 w-4" />
                  </button>

                  <p className="text-center text-xs text-gray-400">
                    Phone number: <span className="font-medium text-gray-500">{phone}</span>{' '}
                    <button onClick={() => { setResult(null); setPhone(''); }} className="text-blue-500 hover:underline ml-1">
                      Not you?
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-white/50 text-xs">
            Need help? Contact the school office on 014 763 1358 or WhatsApp 071 167 9620
          </p>
        </div>
      </div>
    </div>
  );
};

export default ParentWelcome;
