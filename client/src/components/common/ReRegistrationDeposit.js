import React,{useState,useRef} from 'react';
export function ProofViewer({proof,getBlob}) {
  const [url,setUrl]=useState('');const [mime,setMime]=useState('');const [error,setError]=useState('');
  React.useEffect(()=>()=>{if(url) URL.revokeObjectURL(url);},[url]);
  const view=async()=>{
    try {const blob=await getBlob(`/api/payment-proofs/${proof.id}/receipt`);setMime(blob.type);setUrl(URL.createObjectURL(blob));}
    catch {setError('Could not open this proof. Please try again.');}
  };
  return <><button type="button" className="rr-button rr-secondary" onClick={view}>View proof</button>
    {error && <p role="alert">{error}</p>}{url && <div className="rr-proof-view">
      {mime.includes('pdf') ? <iframe title="Proof of payment" src={url} sandbox=""/> : <img src={url} alt="Proof of payment"/>}
      <button type="button" className="rr-button rr-secondary" onClick={()=>setUrl('')}>Close proof</button></div>}</>;
}
export default function ReRegistrationDeposit({data,childId,request,getBlob,onUpdate}) {
  const deposit=data.deposit;
  const [open,setOpen]=useState(false);const [value,setValue]=useState(String(deposit?.outstanding || 500));
  const [paymentDate,setPaymentDate]=useState('');const [method,setMethod]=useState('eft');const [file,setFile]=useState(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const retry=useRef(null);
  if (!deposit?.required || !deposit.invoice_id) return null;
  const upload=async()=>{
    setError('');setNotice('');
    if (!file || file.size>10*1024*1024 || !['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)) {
      setError('Upload a PDF, JPG, PNG or WebP no larger than 10MB.');return;
    }
    if (!paymentDate || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || Number(value)<=0) {setError('Enter the amount paid and payment date.');return;}
    const signature=[value,paymentDate,method,file.name,file.lastModified,file.size].join('|');
    if (retry.current?.signature!==signature) retry.current={signature,key:crypto.randomUUID()};
    const body=new FormData();body.append('amount',value);body.append('payment_date',paymentDate);
    body.append('payment_method',method);body.append('receipt',file);body.append('request_key',retry.current.key);
    setBusy(true);
    try {onUpdate(await request(`/re-registration/deposit-proof?child_id=${childId}`,{method:'POST',body}));
      setOpen(false);setNotice('Proof received. Admin will check that the money reached the school account.');retry.current=null;}
    catch(err){setError(err.message);}finally{setBusy(false);}
  };
  return <section className="rr-card"><h2>Re-registration deposit</h2>
    <div className="rr-notice"><strong>{deposit.verified ? 'Deposit verified' : `R${deposit.outstanding.toFixed(2)} still to be verified`}</strong>
      This R500 fee is separate from monthly tuition. Due by <b>11 January 2027</b>.</div>
    {!deposit.verified && <><p>Pay using your bank app. Use <b>{data.child.student_number}</b> as the payment reference.</p>
      <dl className="rr-bank"><dt>Bank</dt><dd>{deposit.bank.bank}</dd><dt>Account holder</dt><dd>{deposit.bank.holder}</dd>
        <dt>Account number</dt><dd>{deposit.bank.account}</dd><dt>Branch code</dt><dd>{deposit.bank.branch}</dd></dl>
      <p>Already paid? Upload your proof or contact the school office. <b>Do not pay again.</b></p>
      {deposit.pending_amount>0 && <p>R{deposit.pending_amount.toFixed(2)} is awaiting Admin verification.</p>}
      {deposit.outstanding>deposit.pending_amount && !open && <button type="button" className="rr-button" onClick={()=>setOpen(true)}>Upload proof of payment</button>}
      {open && <div className="rr-fields"><div><label htmlFor="rr-deposit-amount">Amount paid</label><input id="rr-deposit-amount" value={value} inputMode="decimal" disabled={busy} onChange={e=>setValue(e.target.value)}/></div>
        <div><label htmlFor="rr-payment-date">Payment date</label><input id="rr-payment-date" type="date" value={paymentDate} disabled={busy} onChange={e=>setPaymentDate(e.target.value)}/></div>
        <div><label htmlFor="rr-payment-method">Payment method</label><select id="rr-payment-method" value={method} disabled={busy} onChange={e=>setMethod(e.target.value)}>
          <option value="eft">EFT / Bank Transfer</option><option value="atm">ATM Deposit</option><option value="cash">Cash Payment</option><option value="card">Card Payment</option><option value="online">Online / SnapScan</option></select></div>
        <div><label htmlFor="rr-receipt">Upload Receipt</label><input id="rr-receipt" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={e=>setFile(e.target.files[0])}/></div>
        <button type="button" className="rr-button" disabled={busy} onClick={upload}>{busy?'Please wait…':'Submit Proof of Payment'}</button></div>}</>}
    {deposit.proofs.map(proof=><div className="rr-proof" key={proof.id}><p>R{Number(proof.amount).toFixed(2)} · {proof.status==='pending'?'Awaiting verification':proof.status==='approved'?'Approved proof':'Rejected proof'} {proof.admin_note && `· ${proof.admin_note}`}</p><ProofViewer proof={proof} getBlob={getBlob}/></div>)}
    {error && <p role="alert" className="rr-error rr-notice">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button className="rr-button rr-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{onUpdate(await request(`/re-registration?child_id=${childId}`));}catch(err){setError(err.message);}finally{setBusy(false);}}}>Refresh status</button>
  </section>;
}
