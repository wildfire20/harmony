import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, CheckCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import ParentPasswordRequirements, { passwordIsValid } from './ParentPasswordRequirements';

const ParentActivation = () => {
  const [params] = useSearchParams(); const token = params.get('token') || '';
  const navigate = useNavigate();
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [details, setDetails] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) { setValidating(false); return; }
    fetch(`/api/parent/activation/validate?token=${encodeURIComponent(token)}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'This activation link is invalid or expired.');
        setDetails(data.parent || data);
        setValid(true);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setValidating(false));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    if (!passwordIsValid(password)) return toast.error('Password must be at least 8 characters.');
    if (password !== confirmation) return toast.error('Passwords do not match.');
    setSaving(true);
    try {
      const res = await fetch('/api/parent/activate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Unable to activate your account.');
      toast.success('Your parent portal is ready.');
      if (data.token) {
        sessionStorage.setItem('parentToken', data.token);
        if (data.user || data.parent) sessionStorage.setItem('parentUser', JSON.stringify(data.user || data.parent));
        if (data.children) sessionStorage.setItem('parentChildren', JSON.stringify(data.children));
        if (data.child) sessionStorage.setItem('parentChild', JSON.stringify(data.child));
      }
      navigate(data.token ? '/parent/dashboard' : '/parent/login', { replace: true });
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  return <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex items-center justify-center p-4">
    <div className="w-full max-w-md">
      <div className="text-center mb-7"><BookOpen className="mx-auto h-12 w-12 text-white mb-3" /><h1 className="text-2xl font-bold text-white">Activate Parent Portal</h1><p className="text-blue-200 text-sm">Harmony Learning Institute</p></div>
      <div className="bg-white rounded-2xl shadow-2xl p-7">
        {validating ? <p className="text-center text-gray-500 py-8">Checking your secure link…</p> : !valid ? <div className="text-center"><ShieldCheck className="mx-auto h-12 w-12 text-red-500 mb-3" /><p className="text-gray-600 text-sm mb-5">This activation link is invalid or expired. Please ask the school to send a new one.</p><button onClick={() => navigate('/parent/login')} className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold">Go to Parent Login</button></div> :
          <><div className="mb-5"><h2 className="font-bold text-gray-800">Create your password</h2><p className="text-sm text-gray-500 mt-1">Welcome{details?.identity?.name ? `, ${details.identity.name}` : ''}. Set a password to enter your portal.</p><p className="text-xs text-gray-400 mt-1">Phone: {details?.identity?.phone || 'Unavailable'}</p></div>
            <form onSubmit={submit} className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">New password</label><div className="relative"><input autoFocus required type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 pr-11 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500" autoComplete="new-password" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-gray-400">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><ParentPasswordRequirements password={password} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label><input required type={show ? 'text' : 'password'} value={confirmation} onChange={e => setConfirmation(e.target.value)} className="w-full px-4 py-3 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500" autoComplete="new-password" /></div>
              <button disabled={saving} className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold disabled:opacity-60">{saving ? 'Activating…' : 'Activate my portal'}</button>
            </form></>}
      </div>
    </div>
  </div>;
};
export default ParentActivation;