import React, {useEffect, useRef, useState} from 'react';

const formats = {'application/pdf':'pdf', 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp'};

export default function ProofViewer({proof, getBlob}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cached = useRef(null), generation = useRef(0), pendingWindow = useRef(null);

  useEffect(() => {
    generation.current += 1;
    setFile(null); setPreview(false); setPreviewFailed(false); setBusy(false); setError(''); setNotice('');
    return () => {
      generation.current += 1;
      if (cached.current) URL.revokeObjectURL(cached.current.url);
      cached.current = null;
      if (pendingWindow.current && !pendingWindow.current.closed) pendingWindow.current.close();
      pendingWindow.current = null;
    };
  }, [proof.id]);

  const run = async action => {
    if (busy) return;
    const current = generation.current;
    // Create the tab during the click; authentication and file retrieval happen afterwards.
    const tab = action === 'open' ? window.open('about:blank', '_blank') : null;
    if (action === 'open' && !tab) {
      setError('Your browser blocked the new tab. Allow pop-ups for this website, or choose Download proof.');
      return;
    }
    if (tab) {tab.opener = null; pendingWindow.current = tab;}
    setBusy(true); setError(''); setNotice('');
    try {
      let loaded = cached.current;
      if (!loaded) {
        const blob = await getBlob(`/api/payment-proofs/${proof.id}/receipt`);
        if (generation.current !== current) {if (tab && !tab.closed) tab.close(); return;}
        const mime = blob?.type?.split(';')[0].trim().toLowerCase();
        if (!formats[mime]) throw new Error('This file cannot be displayed safely. Payment proofs must be PDF, JPG, PNG or WebP files.');
        const name = String(proof.receipt_file_name || `Payment-proof-${proof.id}.${formats[mime]}`)
          .replace(/[/\\\u0000-\u001f\u007f]/g, '_');
        loaded = {url:URL.createObjectURL(blob), mime, name};
        cached.current = loaded;
        setFile(loaded);
      }
      if (action === 'open') {
        if (!tab.closed) tab.location.replace(loaded.url);
        pendingWindow.current = null;
        setNotice('Proof opened in a new tab. You can view, save or print it there.');
      } else if (action === 'download') {
        const link = document.createElement('a');
        link.href = loaded.url; link.download = loaded.name;
        document.body.appendChild(link); link.click(); link.remove();
        setNotice('Proof downloaded. Open the saved file to view or print it.');
      } else {setPreviewFailed(false); setPreview(true);}
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      if (generation.current !== current) return;
      pendingWindow.current = null;
      let message = err.message;
      if (err.response?.data instanceof Blob) {
        try {message = JSON.parse(await err.response.data.text()).message;} catch {/* Use the fallback below. */}
      }
      if (generation.current !== current) return;
      setError(message && !/^(Request failed|Network Error)/.test(message) ? message : 'Could not load this proof. Refresh and try again.');
    } finally {if (generation.current === current) setBusy(false);}
  };

  return <div className="rr-proof-access">
    <div className="rr-button-row">
      <button type="button" className="rr-button rr-secondary" disabled={busy} onClick={() => run('preview')}>View proof</button>
      <button type="button" className="rr-button rr-secondary" disabled={busy} onClick={() => run('open')}>Open proof in new tab</button>
      <button type="button" className="rr-button rr-secondary" disabled={busy} onClick={() => run('download')}>Download proof</button>
    </div>
    {busy && <p role="status">Loading proof…</p>}
    {error && <p role="alert" className="rr-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {preview && file && <div className="rr-proof-view">
      <p className="rr-proof-name">{file.name}</p>
      <p>If the preview is blank or blocked, use Open proof in new tab or Download proof above.</p>
      {!previewFailed && (file.mime === 'application/pdf'
        // Native PDF viewers have their own sandbox. An iframe sandbox blocks them in Edge/Chrome.
        ? <iframe title="Proof of payment" src={file.url} referrerPolicy="no-referrer" onError={() => setPreviewFailed(true)}/>
        : <img src={file.url} alt="Proof of payment" onError={() => setPreviewFailed(true)}/>)}
      {previewFailed && <p role="status">This browser could not display the proof inline. Use Open proof in new tab or Download proof.</p>}
      <button type="button" className="rr-button rr-secondary" onClick={() => setPreview(false)}>Close proof</button>
    </div>}
  </div>;
}
