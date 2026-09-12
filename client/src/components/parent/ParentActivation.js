import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, Eye, EyeOff, Mail, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ParentPasswordRequirements, { passwordIsValid } from './ParentPasswordRequirements';
import './ParentPortal.css';
import { useAppConfig } from '../../contexts/AppConfigContext';

const REQUEST_PATH = '/api/parent/activation/request';
const VERIFY_PATH = '/api/parent/activation/verify';
const COMPLETE_PATH = '/api/parent/activation/complete';

const responseMessage = async (response, fallback) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || fallback);
  return data;
};

const saveParentSession = (data) => {
  const storage = sessionStorage;
  const token = data.token || data.access_token;
  const user = data.user || data.parent;
  const children = data.children || data.all_children || data.allChildren || [];
  const selected = data.child || data.selected_child || data.selectedChild || children[0] || null;
  if (token) storage.setItem('parentToken', token);
  if (user) storage.setItem('parentUser', JSON.stringify(user));
  storage.setItem('parentChildren', JSON.stringify(children));
  if (selected) {
    storage.setItem('parentChild', JSON.stringify(selected));
    if (selected.id) localStorage.setItem('parentSelectedChildId', String(selected.id));
  } else {
    storage.removeItem('parentChild');
    localStorage.removeItem('parentSelectedChildId');
  }
  return token;
};

const ParentActivation = () => {
  const navigate = useNavigate();
  const { parentSelfActivationEnabled, configLoading } = useAppConfig();
  const [stage, setStage] = useState(1);
  const [form, setForm] = useState({ phone_number: '', email: '', email_confirmation: '' });
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  if (configLoading || !parentSelfActivationEnabled) {
    return (
      <div className="parent-activation min-h-[100dvh] bg-[#17324d] px-4 py-6 sm:py-10">
        <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col justify-center text-center">
          <div className="rounded-3xl bg-white p-6 shadow-[0_20px_55px_rgba(16,40,62,.25)] sm:p-8">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white p-2 shadow-lg">
              <img src="/images/harmony-logo.png" alt="Harmony Learning Institute" className="max-h-full max-w-full object-contain" />
            </div>
            <h1 className="text-2xl font-bold text-[#19324a]">Parent Portal</h1>
            <p className="mt-3 text-sm leading-6 text-[#617487]" role="status">
              {configLoading ? 'Checking self-activation availability…' : 'Self-activation is not available yet.'}
            </p>
            {!configLoading && (
              <div className="mt-6 space-y-3">
                <button type="button" onClick={() => navigate('/parent/login')} className="w-full rounded-xl bg-[#2c7475] py-3.5 font-semibold text-white hover:bg-[#245f61]">
                  Sign in
                </button>
                <button type="button" onClick={() => navigate('/parent/forgot-password')} className="text-sm font-semibold text-[#176b73] hover:underline">
                  Forgot Password?
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const update = field => event => {
    setForm(current => ({ ...current, [field]: event.target.value }));
    setError('');
  };

  const requestCode = async (event, resend = false) => {
    event?.preventDefault();
    setError('');
    const email = form.email.trim();
    const confirmationEmail = form.email_confirmation.trim();
    const phone = form.phone_number.trim();
    if (!phone) return setError('Enter the mobile number registered with your school.');
    if (!email || !email.includes('@')) return setError('Enter a valid email address.');
    if (email !== confirmationEmail) return setError('Email addresses do not match.');
    if (resend && cooldown > 0) return;
    setBusy(true);
    try {
      const response = await fetch(REQUEST_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: phone,
          email,
          email_confirmation: confirmationEmail,
        }),
      });
      const data = await responseMessage(response, 'We could not send your verification code.');
      if (!data.challenge_id && !data.challengeId) {
        setMessage('');
        throw new Error(data.message || 'We could not verify those details. Please contact your school.');
      }
      setVerification(data);
      setStage(2);
      setCooldown(60);
      setMessage(resend ? 'A new verification code has been sent to your email.' : 'We sent a six-digit verification code to your email.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async event => {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp)) return setError('Enter the six-digit code from your email.');
    setBusy(true);
    try {
      const response = await fetch(VERIFY_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: form.phone_number.trim(),
          email: form.email.trim(),
          otp,
          verification_token: verification?.verification_token || verification?.token || verification?.challenge_token,
          challenge_id: verification?.challenge_id || verification?.challengeId,
        }),
      });
      const data = await responseMessage(response, 'That code is not valid. Check your email and try again.');
      setVerification(current => ({ ...current, ...data }));
      setStage(3);
      setMessage('Your email is verified. Create a password for your Parent Portal.');
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setBusy(false);
    }
  };

  const completeActivation = async event => {
    event.preventDefault();
    setError('');
    if (!passwordIsValid(password)) return setError('Password must be at least 8 characters.');
    if (password !== confirmation) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const response = await fetch(COMPLETE_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: form.phone_number.trim(),
          email: form.email.trim(),
          password,
          password_confirmation: confirmation,
          verification_token: verification?.verification_token || verification?.token || verification?.challenge_token,
          completion_token: verification?.completion_token || verification?.completionToken,
          challenge_id: verification?.challenge_id || verification?.challengeId,
        }),
      });
      const data = await responseMessage(response, 'We could not activate your Parent Portal.');
      const token = saveParentSession(data);
      if (!token) throw new Error('Your account was created, but we could not start your secure session. Please sign in.');
      navigate('/parent/dashboard', { replace: true });
    } catch (completeError) {
      setError(completeError.message);
    } finally {
      setBusy(false);
    }
  };

  const stageTitle = stage === 1 ? 'Confirm your details' : stage === 2 ? 'Check your email' : 'Create your password';

  return (
    <div className="parent-activation min-h-[100dvh] bg-[#17324d] px-4 py-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-lg flex-col justify-center">
        <header className="mb-6 text-center text-white">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white p-2 shadow-lg">
            <img src="/images/harmony-logo.png" alt="Harmony Learning Institute" className="max-h-full max-w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold sm:text-3xl">Activate your Parent Portal</h1>
          <p className="mt-2 text-sm text-[#c9dddf]">A quick, secure self-activation</p>
        </header>

        <div className="rounded-3xl bg-white p-5 shadow-[0_20px_55px_rgba(16,40,62,.25)] sm:p-8">
          <div className="mb-7 flex items-center justify-between gap-2" aria-label={`Activation step ${stage} of 3`}>
            {[1, 2, 3].map(number => (
              <React.Fragment key={number}>
                <div className={`flex items-center gap-2 text-xs font-semibold ${stage >= number ? 'text-[#176b73]' : 'text-[#84929e]'}`}>
                  <span className={`grid h-8 w-8 place-items-center rounded-full border-2 ${stage >= number ? 'border-[#2c7475] bg-[#2c7475] text-white' : 'border-[#cbd9df]'}`} aria-current={stage === number ? 'step' : undefined}>
                    {stage > number ? <CheckCircle className="h-4 w-4" /> : number}
                  </span>
                  <span className="hidden sm:inline">{number === 1 ? 'Details' : number === 2 ? 'Verify' : 'Password'}</span>
                </div>
                {number < 3 && <div className={`h-px flex-1 ${stage > number ? 'bg-[#2c7475]' : 'bg-[#dce6ea]'}`} />}
              </React.Fragment>
            ))}
          </div>

          <div className="mb-5">
            <h2 className="text-xl font-bold text-[#19324a]">{stageTitle}</h2>
            <p className="mt-1 text-sm leading-6 text-[#617487]">
              {stage === 1 && 'Use the mobile number registered with your school and an email address you can access.'}
              {stage === 2 && <>We emailed a six-digit code to <strong className="text-[#334b5d]">{form.email}</strong>.</>}
              {stage === 3 && 'Choose a password you will use when signing in.'}
            </p>
          </div>

          {message && <div className="mb-4 rounded-xl border border-[#c9e4d7] bg-[#effaf3] p-3 text-sm text-[#17633d]" role="status" aria-live="polite">{message}</div>}
          {error && <div className="mb-4 rounded-xl border border-[#f0c8c0] bg-[#fff5f2] p-3 text-sm text-[#a94336]" role="alert">{error}</div>}

          {stage === 1 && (
            <form onSubmit={requestCode} className="space-y-4" noValidate>
              <div>
                <label htmlFor="activation-mobile" className="mb-1.5 block text-sm font-semibold text-[#334b5d]">Registered mobile number</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#84929e]" aria-hidden="true" />
                  <input id="activation-mobile" name="phone_number" type="tel" value={form.phone_number} onChange={update('phone_number')} placeholder="073 123 4567" autoComplete="tel" required aria-describedby="mobile-help" className="w-full rounded-xl border border-[#cbd9df] py-3 pl-10 pr-4 text-sm text-[#19324a] outline-none transition focus:border-[#2c7475] focus:ring-2 focus:ring-[#2c7475]/20" />
                </div>
                <p id="mobile-help" className="mt-1 text-xs text-[#84929e]">Use the number registered with Harmony.</p>
              </div>
              <div>
                <label htmlFor="activation-email" className="mb-1.5 block text-sm font-semibold text-[#334b5d]">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#84929e]" aria-hidden="true" />
                  <input id="activation-email" name="email" type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" autoComplete="email" required className="w-full rounded-xl border border-[#cbd9df] py-3 pl-10 pr-4 text-sm text-[#19324a] outline-none transition focus:border-[#2c7475] focus:ring-2 focus:ring-[#2c7475]/20" />
                </div>
              </div>
              <div>
                <label htmlFor="activation-email-confirmation" className="mb-1.5 block text-sm font-semibold text-[#334b5d]">Confirm email address</label>
                <input id="activation-email-confirmation" name="email_confirmation" type="email" value={form.email_confirmation} onChange={update('email_confirmation')} placeholder="you@example.com" autoComplete="email" required className="w-full rounded-xl border border-[#cbd9df] px-4 py-3 text-sm text-[#19324a] outline-none transition focus:border-[#2c7475] focus:ring-2 focus:ring-[#2c7475]/20" />
              </div>
              <p className="rounded-xl bg-[#f1f8f7] p-3 text-xs leading-5 text-[#526879]">Your email is used for account recovery and for important school, learner, and payment notices.</p>
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#2c7475] py-3.5 text-base font-semibold text-white transition hover:bg-[#245f61] disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Sending code…' : 'Send verification code'}</button>
            </form>
          )}

          {stage === 2 && (
            <form onSubmit={verifyCode} className="space-y-4" noValidate>
              <div>
                <label htmlFor="activation-otp" className="mb-1.5 block text-sm font-semibold text-[#334b5d]">Six-digit email verification code</label>
                <input id="activation-otp" name="otp" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={event => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} autoComplete="one-time-code" required aria-describedby="otp-help" className="w-full rounded-xl border border-[#cbd9df] px-4 py-3 text-center text-xl font-semibold tracking-[.35em] text-[#19324a] outline-none transition focus:border-[#2c7475] focus:ring-2 focus:ring-[#2c7475]/20" />
                <p id="otp-help" className="mt-2 text-xs text-[#84929e]">The code expires for your security. If you do not see it, check your junk folder.</p>
              </div>
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#2c7475] py-3.5 text-base font-semibold text-white transition hover:bg-[#245f61] disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Verifying…' : 'Verify email'}</button>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <button type="button" onClick={() => { setStage(1); setMessage(''); setError(''); }} className="flex min-h-[44px] items-center gap-1 font-semibold text-[#176b73] hover:underline"><ArrowLeft className="h-4 w-4" />Change details</button>
                <button type="button" disabled={busy || cooldown > 0} onClick={event => requestCode(event, true)} className="min-h-[44px] font-semibold text-[#176b73] hover:underline disabled:cursor-not-allowed disabled:text-[#84929e]">{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button>
              </div>
            </form>
          )}

          {stage === 3 && (
            <form onSubmit={completeActivation} className="space-y-4" noValidate>
              <div>
                <label htmlFor="activation-password" className="mb-1.5 block text-sm font-semibold text-[#334b5d]">Password</label>
                <div className="relative">
                  <input id="activation-password" name="password" autoFocus required type={showPassword ? 'text' : 'password'} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} autoComplete="new-password" className="w-full rounded-xl border border-[#cbd9df] px-4 py-3 pr-12 text-sm text-[#19324a] outline-none transition focus:border-[#2c7475] focus:ring-2 focus:ring-[#2c7475]/20" />
                  <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#617487]">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
                <ParentPasswordRequirements password={password} />
              </div>
              <div>
                <label htmlFor="activation-password-confirmation" className="mb-1.5 block text-sm font-semibold text-[#334b5d]">Confirm password</label>
                <input id="activation-password-confirmation" name="password_confirmation" required type={showPassword ? 'text' : 'password'} value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(''); }} autoComplete="new-password" className="w-full rounded-xl border border-[#cbd9df] px-4 py-3 text-sm text-[#19324a] outline-none transition focus:border-[#2c7475] focus:ring-2 focus:ring-[#2c7475]/20" />
              </div>
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#2c7475] py-3.5 text-base font-semibold text-white transition hover:bg-[#245f61] disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Activating…' : 'Activate my Parent Portal'}</button>
            </form>
          )}

          <footer className="mt-6 border-t border-[#edf1f0] pt-4 text-center text-xs leading-5 text-[#84929e]">
            Need help? Please contact your school office. Already have an account? <button type="button" onClick={() => navigate('/parent/login')} className="font-semibold text-[#176b73] hover:underline">Sign in</button>.
            <br /><button type="button" onClick={() => navigate('/parent/forgot-password')} className="mt-1 font-semibold text-[#176b73] hover:underline">Forgot Password? Get help signing in.</button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export { saveParentSession };
export default ParentActivation;