import React, { useState } from 'react';
import { ShieldCheck, Users, LogOut, Lock, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const initials = (person) => `${person?.first_name?.[0] || ''}${person?.last_name?.[0] || ''}`.toUpperCase();

export default function ParentAccount({ user, children, selectedChild, onSelectChild, onLogout }) {
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const handleLogout = () => { setMessage('Signing you out…'); onLogout(); };
  return (
    <div className="space-y-5 animate-fade-in">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b5473a]">Your account</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#19324a]">Account & security</h1>
        <p className="mt-2 text-sm text-[#617487]">Keep your contact details and linked learners close at hand.</p>
      </header>
      {message && <div className="rounded-2xl border border-[#c9e4d7] bg-[#effaf3] p-4 text-sm text-[#17633d]">{message}</div>}
      <section className="rounded-3xl border border-[#dce7eb] bg-white p-5 shadow-[0_12px_35px_rgba(31,65,83,.07)]">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#dceef0] text-lg font-bold text-[#176b73]">{initials(user)}</div>
          <div className="min-w-0">
            <h2 className="font-bold text-[#19324a]">{user?.first_name} {user?.last_name}</h2>
            <p className="truncate text-sm text-[#617487]">{user?.email || user?.phone_number || 'Contact details held by Harmony'}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-[#f6f8f6] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#84929e]">Identity</p><p className="mt-1 text-sm text-[#334b5d]">Verified parent account</p></div>
          <div className="rounded-2xl bg-[#f6f8f6] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#84929e]">Session</p><p className="mt-1 text-sm text-[#334b5d]">Protected Harmony session</p></div>
        </div>
      </section>
      <section className="rounded-3xl border border-[#dce7eb] bg-white p-5 shadow-[0_12px_35px_rgba(31,65,83,.07)]">
        <div className="mb-4 flex items-center gap-3"><Users className="h-5 w-5 text-[#176b73]" /><h2 className="font-bold text-[#19324a]">Linked learners</h2></div>
        {children?.length ? <div className="space-y-2">{children.map((child) => <button key={child.id} onClick={() => { onSelectChild(child); navigate('/parent/dashboard'); }} className={`flex min-h-[60px] w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${selectedChild?.id === child.id ? 'border-[#8cc5c4] bg-[#eef8f6]' : 'border-[#edf1f0] hover:bg-[#f7fbfa]'}`}><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fce4dc] text-sm font-bold text-[#a94336]">{initials(child)}</span><span><strong className="block text-sm text-[#334b5d]">{child.first_name} {child.last_name}</strong><small className="text-xs text-[#84929e]">{child.grade_name || 'Learner'}{child.student_number ? ` · ${child.student_number}` : ''}{selectedChild?.id === child.id ? ' · Selected' : ''}</small></span></button>)}</div> : <div className="rounded-2xl bg-[#fff8ed] p-4 text-sm text-[#8a5b22]">No learner is currently linked. Please contact Harmony if this does not look right.</div>}
      </section>
      <section className="rounded-3xl border border-[#dce7eb] bg-white p-5 shadow-[0_12px_35px_rgba(31,65,83,.07)]">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#176b73]" /><div><h2 className="font-bold text-[#19324a]">Security</h2><p className="mt-1 text-sm leading-6 text-[#617487]">Password and all-device sign-out options are available where your account supports them.</p></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={() => navigate('/parent/change-password')} className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-[#b9d5d4] text-sm font-semibold text-[#176b73] transition-colors hover:bg-[#eef8f6]"><Lock className="h-4 w-4" /> Change password</button>
          <button onClick={handleLogout} className="parent-account-signout flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#19324a] text-sm font-semibold text-white transition-transform active:scale-[.98]"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      </section>
      <div className="flex items-start gap-2 text-xs leading-5 text-[#84929e]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Harmony only shows information your parent account is authorised to see.</div>
    </div>
  );
}