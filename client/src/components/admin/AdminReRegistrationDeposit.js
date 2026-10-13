import React,{useRef,useState} from 'react';
import {ProofViewer} from '../common/ReRegistrationDeposit';
export default function AdminReRegistrationDeposit({data,request,getBlob,onUpdate}) {
  const deposit=data.deposit;
  const [open,setOpen]=useState(false),[value,setValue]=useState(String(deposit?.outstanding || 500));
  const [date,setDate]=useState(''),[method,setMethod]=useState('eft'),[receipt,setReceipt]=useState('');
  const [confirmed,setConfirmed]=useState(false),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const retry=useRef(null);
  if (!deposit?.required || !deposit.invoice_id) return null;
  const send=async(path,body)=>{
    const signature=JSON.stringify({path,body});
    if (retry.current?.signature!==signature) retry.current={signature,key:crypto.randomUUID()};
    setBusy(true);setError('');
    try {onUpdate(await request(path,{...body,request_key:retry.current.key}));retry.current=null;setOpen(false);setConfirmed(false);setNote('');}
    catch(err){setError(err.message);}finally{setBusy(false);}
  };
  return <section className="rr-card"><h2>Deposit verification</h2>
    <div className="rr-notice"><strong>{deposit.verified?'Deposit verified':`R${deposit.outstanding.toFixed(2)} outstanding`}</strong>
      Separate R500 re-registration fee. Amount paid: R{deposit.amount_paid.toFixed(2)}.</div>
    {deposit.receipt_number && <p>Receipt number: {deposit.receipt_number}</p>}
    <p>Check the bank statement or school POS receipt. A screenshot alone does not confirm payment.</p>
    <label className="rr-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>I confirm that the school has received this money.</span></label>
    <label htmlFor="rr-deposit-note">Payment note / rejection reason</label><textarea id="rr-deposit-note" rows={2} maxLength={1500} value={note} onChange={e=>setNote(e.target.value)}/>
    {deposit.proofs.map(proof=><div className="rr-proof" key={proof.id}><p>Proof #{proof.id} · R{Number(proof.amount).toFixed(2)} · {proof.status}</p>
      {proof.admin_note && <p>{proof.admin_note}</p>}<div className="rr-button-row"><ProofViewer proof={proof} getBlob={getBlob}/>
        {proof.status==='pending' && <><button className="rr-button" disabled={busy || !confirmed} onClick={()=>send('/proof',{action:'verify',proof_id:proof.id,bank_confirmed:confirmed,note})}>Verify deposit</button>
          <button className="rr-button rr-secondary" disabled={busy || !note.trim()} onClick={()=>send('/proof',{action:'reject',proof_id:proof.id,note})}>Reject proof</button></>}</div></div>)}
    {!deposit.verified && <><p>For cash or card payments received at school, record the actual receipt below. If Finance already recorded the payment, apply that existing payment to this fee in Finance. <b>Do not record it twice.</b></p>
      {!open && <button className="rr-button rr-secondary" disabled={busy} onClick={()=>setOpen(true)}>Record deposit received</button>}
      {open && <div className="rr-fields"><div><label htmlFor="rr-admin-amount">Amount received</label><input id="rr-admin-amount" inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)}/></div>
        <div><label htmlFor="rr-admin-date">Payment date</label><input id="rr-admin-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
        <div><label htmlFor="rr-admin-method">Payment method</label><select id="rr-admin-method" value={method} onChange={e=>setMethod(e.target.value)}>
          <option value="eft">EFT / Bank Transfer</option><option value="atm">ATM Deposit</option><option value="cash">Cash Payment</option><option value="card">Card Payment</option><option value="online">Online / SnapScan</option></select></div>
        <div><label htmlFor="rr-admin-receipt">Bank / POS receipt number</label><input id="rr-admin-receipt" maxLength={160} value={receipt} onChange={e=>setReceipt(e.target.value)}/></div>
        <button className="rr-button" disabled={busy || !confirmed || !date || !receipt.trim()} onClick={()=>send('/deposit',{amount:value,payment_date:date,payment_method:method,receipt_number:receipt,bank_confirmed:confirmed})}>Save deposit payment</button></div>}</>}
    {error && <p role="alert" className="rr-notice rr-error">{error}</p>}
  </section>;
}
