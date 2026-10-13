const crypto = require('node:crypto');
const finance = require('./financeCommandService');
const { acquireInvoiceObligationLocks } = require('./invoiceObligationLocks');
const definition = require('../client/src/data/reRegistration2027.json');
const { feeTerms } = require('./parentReRegistrationPolicy');
const fail = (status,message) => Object.assign(new Error(message),{status});
const actorFor = actor => ({id:actor.id,role:actor.role,name:`${actor.first_name || ''} ${actor.last_name || ''}`.trim()});
const amount = value => {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(String(value)) || Number(value)<=0) throw fail(400,'Enter a positive amount with at most two decimal places.');
  return Number(value);
};
const date = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString().slice(0,10)!==value || value>new Date().toISOString().slice(0,10)) throw fail(400,'Enter a valid payment date.');
  return value;
};
const methods = ['eft','bank_transfer','atm','cash','card','online'];
async function load(client,row,lock=false) {
  if (!row?.deposit_invoice_id) return null;
  if (lock) await acquireInvoiceObligationLocks(client,[{invoiceId:row.deposit_invoice_id,studentId:row.student_id,lineId:'legacy',category:'one_off'}]);
  const invoice = (await client.query(`SELECT *,to_char(billing_period,'YYYY-MM-DD') AS period FROM invoices
    WHERE id=$1 AND student_id=$2 ${lock ? 'FOR UPDATE' : ''}`,[row.deposit_invoice_id,row.student_id])).rows[0];
  const lines = (await client.query('SELECT * FROM invoice_line_items WHERE invoice_id=$1 ORDER BY id',[row.deposit_invoice_id])).rows;
  const line=lines[0];
  if (!invoice || invoice.invoice_source!=='parent_reregistration' || invoice.invoice_kind!=='one_off' ||
      Number(invoice.amount_due)!==500 || invoice.period!==`${row.school_year}-01-01` ||
      lines.length!==1 || line.service_key!=='registration' || Number(line.amount)!==500 ||
      line.metadata?.source!=='parent_reregistration' || Number(line.metadata?.registration_id)!==row.id ||
      Number(line.metadata?.school_year)!==row.school_year || line.metadata?.category!=='one_off') throw fail(409,'The re-registration fee needs an Admin review.');
  return {invoice,line};
}
async function pending(client,invoiceId) {
  return (await client.query(`SELECT COALESCE(sum(p.proposed_amount),0) AS amount
    FROM payment_proof_allocation_proposals p JOIN pending_payments pp ON pp.id=p.proof_id
    WHERE p.invoice_id=$1 AND pp.status='pending'`,[invoiceId])).rows[0].amount;
}
async function summary(client,row,actor,lock=false) {
  const terms=feeTerms(row?.form_data || {});
  const current=await load(client,row,lock);
  const proofs=row ? (await client.query(`SELECT pp.id,pp.parent_id,pp.amount,pp.payment_method,pp.status,
    pp.submitted_at,pp.admin_note,m.payment_date,pp.receipt_file_name
    FROM parent_reregistration_proofs m JOIN pending_payments pp ON pp.id=m.proof_id
    WHERE m.registration_id=$1 ${actor.role==='parent' ? 'AND pp.parent_id=$2' : ''}
    ORDER BY pp.id DESC`,actor.role==='parent' ? [row.id,actor.id] : [row.id])).rows : [];
  const live=current && !['Cancelled','Carried Forward'].includes(current.invoice.status);
  const paid=live ? Number(current.invoice.amount_paid) : 0;
  const reserved=live ? Number(await pending(client,current.invoice.id)) : 0;
  return {...terms,bank:definition.bank,invoice_id:current?.invoice.id || null,
    amount_paid:paid,outstanding:terms.required ? Math.max(0,500-paid) : 0,pending_amount:reserved,
    verified:!terms.required || Boolean(live && paid>=500),proofs,receipt_number:row?.receipt_number || null};
}
async function reserve(client,row,value) {
  const target=await load(client,row,true);
  if (!feeTerms(row.form_data).required || !target || ['Cancelled','Carried Forward'].includes(target.invoice.status)) throw fail(409,'There is no active deposit to pay.');
  const remaining=500-Number(target.invoice.amount_paid)-Number(await pending(client,target.invoice.id));
  if (value>remaining+.001) throw fail(409,'The deposit is already covered by a payment or pending proof. Refresh the status before paying again.');
  return target;
}
const obligation = (target,value) => ({invoice_id:target.invoice.id,invoice_line_item_id:target.line.id,category:'one_off',amount:value});
async function submitProof(client,row,actor,body,file) {
  const value=amount(body.amount);const paymentDate=date(body.payment_date);
  if (!methods.includes(body.payment_method)) throw fail(400,'Choose a valid payment method.');
  if (!file) throw fail(400,'Upload a screenshot or proof of payment.');
  const hash=crypto.createHash('sha256').update(JSON.stringify({amount:value,paymentDate,method:body.payment_method})).update(file.buffer).digest('hex');
  const prior=(await client.query(`SELECT m.*,p.parent_id,p.student_id FROM parent_reregistration_proofs m
    JOIN pending_payments p ON p.id=m.proof_id WHERE m.request_key=$1::uuid`,[body.request_key])).rows[0];
  if (prior) {
    if (prior.parent_id!==actor.id || prior.student_id!==row.student_id || prior.payload_hash!==hash) throw fail(409,'This proof request has changed. Refresh and try again.');
    return {duplicate:true};
  }
  const target=await reserve(client,row,value);
  const result=await finance.createPaymentProof({executor:client,parentId:actor.id,learnerId:row.student_id,amount:value,
    paymentMethod:body.payment_method,reference:`RR-${row.school_year}-${row.student_id}`,
    notes:'Re-registration deposit',receiptFileName:file.originalname.slice(0,255),receiptMime:file.mimetype,
    receiptData:file.buffer,obligations:[obligation(target,value)],idempotencyKey:`rereg-proof:${body.request_key}`,actor:actorFor(actor)});
  await client.query('UPDATE pending_payments SET payment_date=$2::date WHERE id=$1',[result.submission.id,paymentDate]);
  await client.query(`INSERT INTO parent_reregistration_proofs(proof_id,registration_id,payment_date,request_key,payload_hash)
    VALUES($1,$2,$3::date,$4::uuid,$5)`,[result.submission.id,row.id,paymentDate,body.request_key,hash]);
  return {proof_id:result.submission.id};
}
async function reviewProof(client,row,actor,body) {
  if (!['verify','reject'].includes(body.action)) throw fail(400,'Choose Verify deposit or Reject proof.');
  if (body.action==='verify' && body.bank_confirmed!==true) throw fail(400,'Confirm that the money is received in the school account.');
  if (body.action==='reject' && !String(body.note || '').trim()) throw fail(400,'Give the parent a reason for rejecting this proof.');
  const target=await load(client,row,true);
  const proof=(await client.query(`SELECT pp.* FROM pending_payments pp JOIN parent_reregistration_proofs m ON m.proof_id=pp.id
    WHERE pp.id=$1 AND m.registration_id=$2 AND pp.student_id=$3 FOR UPDATE OF pp`,[body.proof_id,row.id,row.student_id])).rows[0];
  if (!target || !proof) throw fail(404,'Deposit proof not found for this learner.');
  const plan=(await client.query('SELECT * FROM payment_proof_allocation_proposals WHERE proof_id=$1 ORDER BY id',[proof.id])).rows;
  if (plan.length!==1 || plan[0].invoice_id!==target.invoice.id || plan[0].invoice_line_item_id!==target.line.id ||
      plan[0].category!=='one_off' || Number(plan[0].proposed_amount)!==Number(proof.amount)) throw fail(409,'The proof allocation has changed. Review it in Finance.');
  if (body.action==='verify') {
    await finance.approveProof({executor:client,proofId:proof.id,adminNote:String(body.note || '').slice(0,1500),actor:actorFor(actor)});
    await client.query('UPDATE parent_reregistrations SET receipt_number=$2 WHERE id=$1',[row.id,`PROOF-${proof.id}`]);
  } else await finance.rejectProof({executor:client,proofId:proof.id,adminNote:body.note,actor:actorFor(actor)});
}
async function recordDeposit(client,row,actor,body) {
  if (body.bank_confirmed!==true) throw fail(400,'Confirm that the school has received the money.');
  const value=amount(body.amount);const paymentDate=date(body.payment_date);
  if (!methods.includes(body.payment_method) || !String(body.receipt_number || '').trim()) throw fail(400,'Choose a payment method and enter the bank or POS receipt number.');
  const target=await reserve(client,row,value);
  await finance.recordPayment({executor:client,studentId:row.student_id,amount:value,paymentDate,
    paymentMethod:body.payment_method,reference:body.receipt_number,description:'Re-registration deposit received',
    obligations:[obligation(target,value)],recordedBy:actor.id,idempotencyKey:`rereg-deposit:${body.request_key}`,actor:actorFor(actor)});
  await client.query('UPDATE parent_reregistrations SET receipt_number=$2 WHERE id=$1',[row.id,body.receipt_number]);
}
module.exports={summary,submitProof,reviewProof,recordDeposit,actorFor};
