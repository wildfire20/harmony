import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, XCircle, LogIn, LogOut, Wifi, Clock } from 'lucide-react';

const DISPLAY_MS = 5000;

const StaffScanStation = () => {
  const [status, setStatus] = useState('idle'); // 'idle' | 'success-in' | 'success-out' | 'error'
  const [message, setMessage] = useState('');
  const [staffName, setStaffName] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [recentScans, setRecentScans] = useState([]);
  const inputRef = useRef(null);
  const bufferRef = useRef('');
  const timerRef = useRef(null);
  const resetRef = useRef(null);

  // Clock tick
  useEffect(() => {
    const tick = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Keep hidden input focused
  const refocusInput = useCallback(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    refocusInput();
    document.addEventListener('click', refocusInput);
    document.addEventListener('touchend', refocusInput);
    return () => {
      document.removeEventListener('click', refocusInput);
      document.removeEventListener('touchend', refocusInput);
    };
  }, [refocusInput]);

  const resetToIdle = useCallback(() => {
    setStatus('idle');
    setMessage('');
    setStaffName('');
    bufferRef.current = '';
    refocusInput();
  }, [refocusInput]);

  const processCard = useCallback(async (cardId) => {
    try {
      const response = await fetch('/api/staff-attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      });
      const data = await response.json();

      if (data.success) {
        setStaffName(data.staff.name);
        setMessage(data.message);
        setStatus(data.action === 'in' ? 'success-in' : 'success-out');
        setRecentScans(prev => [
          {
            name: data.staff.name,
            action: data.action,
            time: new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
          },
          ...prev.slice(0, 4),
        ]);
      } else {
        setMessage(data.message || 'Card not recognised');
        setStatus('error');
      }
    } catch {
      setMessage('Connection error. Please check the network.');
      setStatus('error');
    }

    clearTimeout(resetRef.current);
    resetRef.current = setTimeout(resetToIdle, DISPLAY_MS);
  }, [resetToIdle]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const cardId = bufferRef.current.trim();
      bufferRef.current = '';
      if (cardId) processCard(cardId);
    } else if (e.key.length === 1) {
      bufferRef.current += e.key;
    }
  }, [processCard]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Cleanup timer on unmount
  useEffect(() => () => { clearTimeout(timerRef.current); clearTimeout(resetRef.current); }, []);

  const fmtDate = currentTime.toLocaleDateString('en-ZA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const fmtTime = currentTime.toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      className="min-h-screen bg-gray-950 flex flex-col select-none"
      style={{ fontFamily: 'system-ui, sans-serif' }}
    >
      {/* Hidden scanner input */}
      <input
        ref={inputRef}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        onChange={() => {}}
        value=""
        autoFocus
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-600 to-blue-700 flex items-center justify-center">
            <span className="text-white font-bold text-sm">HL</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Harmony Learning Institute</p>
            <p className="text-gray-400 text-xs">Staff Attendance Station</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <Wifi className="w-4 h-4 text-green-400" />
          <div>
            <p className="text-white font-mono text-lg leading-tight">{fmtTime}</p>
            <p className="text-gray-400 text-xs">{fmtDate}</p>
          </div>
        </div>
      </div>

      {/* Main scan area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">

        {status === 'idle' && (
          <div className="text-center">
            <div className="relative mb-8">
              <div className="w-36 h-36 mx-auto rounded-full bg-gray-800 border-4 border-gray-700 flex items-center justify-center animate-pulse">
                <svg className="w-16 h-16 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 10h2a1 1 0 001-1V6a1 1 0 011-1h3M3 14h2a1 1 0 011 1v3a1 1 0 001 1h3M14 3h3a1 1 0 011 1v3a1 1 0 001 1h2M14 21h3a1 1 0 001-1v-3a1 1 0 011-1h2" />
                </svg>
              </div>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">Ready to Scan</h1>
            <p className="text-gray-400 text-lg">Hold your card near the scanner</p>
          </div>
        )}

        {(status === 'success-in' || status === 'success-out') && (
          <div className="text-center">
            <div className={`w-36 h-36 mx-auto rounded-full flex items-center justify-center mb-8 ${
              status === 'success-in'
                ? 'bg-green-500/20 border-4 border-green-500'
                : 'bg-blue-500/20 border-4 border-blue-500'
            }`}>
              {status === 'success-in'
                ? <LogIn className="w-16 h-16 text-green-400" />
                : <LogOut className="w-16 h-16 text-blue-400" />
              }
            </div>
            <h1 className={`text-3xl md:text-4xl font-bold mb-2 ${
              status === 'success-in' ? 'text-green-400' : 'text-blue-400'
            }`}>
              {status === 'success-in' ? 'Signed In' : 'Signed Out'}
            </h1>
            <p className="text-white text-2xl md:text-3xl font-semibold mb-2">{staffName}</p>
            <p className="text-gray-300 text-lg">{message}</p>
            <div className="mt-6 flex items-center justify-center gap-2 text-gray-500 text-sm">
              <Clock className="w-4 h-4" />
              <span>{fmtTime}</span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="w-36 h-36 mx-auto rounded-full bg-red-500/20 border-4 border-red-500 flex items-center justify-center mb-8">
              <XCircle className="w-16 h-16 text-red-400" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-red-400 mb-3">Scan Failed</h1>
            <p className="text-gray-200 text-lg max-w-sm mx-auto">{message}</p>
          </div>
        )}
      </div>

      {/* Recent scans footer */}
      {recentScans.length > 0 && (
        <div className="bg-gray-900 border-t border-gray-800 px-4 py-3">
          <p className="text-gray-500 text-xs uppercase tracking-wide mb-2 text-center">Recent Activity</p>
          <div className="flex flex-wrap justify-center gap-2">
            {recentScans.map((s, i) => (
              <div
                key={i}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                  s.action === 'in'
                    ? 'bg-green-900/50 text-green-300 border border-green-800'
                    : 'bg-blue-900/50 text-blue-300 border border-blue-800'
                }`}
              >
                {s.action === 'in' ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                <span>{s.name}</span>
                <span className="text-gray-500">{s.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scanning progress bar */}
      {status !== 'idle' && (
        <div className="h-1 bg-gray-800">
          <div
            className={`h-1 transition-all ease-linear ${
              status === 'success-in' ? 'bg-green-500' :
              status === 'success-out' ? 'bg-blue-500' : 'bg-red-500'
            }`}
            style={{ width: '100%', animation: `shrink ${DISPLAY_MS}ms linear forwards` }}
          />
        </div>
      )}

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
};

export default StaffScanStation;
