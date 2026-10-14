const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const commands = require('../services/financeCommandService');

const url = process.env.FINANCE_TEST_DATABASE_URL;
test('payment corrections preserve credit disposition and explicit repairs preserve money', {
  skip: !url, timeout: 60000,
}, async t => {
  const schema = `correction_disposition_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const pool = new Pool({ connectionString: scoped.toString() });
  const actor = { id: 1, role: 'super_admin', name: 'Test administrator' };
  const reason = 'Restore intended allocation after a credit correction';
  const transaction = async work => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const value = await work(c);
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally { c.release(); }
  };
  const reset = async () => {
    await pool.query(`TRUNCATE payment_transactions, audit_logs RESTART IDENTITY;
      SELECT set_config('harmony.finance_command', 'canonical', false);
      UPDATE invoices SET amount_paid=0,status='Unpaid' WHERE id=11`);
  };
  const credit = async (amount = 2350) => (await pool.query(`
    INSERT INTO payment_transactions(student_id,student_number,amount,transaction_date,
      payment_date,payment_method,reference,reference_number,month,year)
    VALUES(2,'TEST-LEARNER',$1,'2026-01-13','2026-01-13','manual_entry','TEST-CREDIT','TEST-CREDIT',2,2026)
    RETURNING *`, [amount])).rows[0];
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(fs.readFileSync(path.join(__dirname,'fixtures','finance-core-base.sql'),'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname,'..','migrations','finance_core_architecture.sql'),'utf8'));
    await pool.query(`INSERT INTO users(id,first_name,last_name,role,student_number)
      VALUES(1,'Test','Admin','super_admin',NULL),(2,'Test','Learner','student','TEST-LEARNER');
      INSERT INTO invoices(id,student_id,student_number,amount_due,amount_paid,due_date,status,description)
      VALUES(10,2,'TEST-LEARNER',2350,2350,'2026-02-28','Paid','Monthly tuition'),
        (11,2,'TEST-LEARNER',2350,0,'2026-10-31','Unpaid','Monthly tuition');
      INSERT INTO invoice_line_items(invoice_id,line_type,service_key,label,unit_amount,amount)
      VALUES(11,'charge','tuition','Tuition',2350,2350)`);

    await t.test('editing an unallocated February payment does not pay October', async () => {
      await reset();
      const source = await credit();
      const result = await transaction(c => commands.correctPayment({ executor:c,
        transactionId:source.id,amount:2750,paymentDate:'2026-01-13',
        actor,reason,idempotencyKey:'preserve-credit' }));
      assert.deepEqual(result.allocation.allocations.map(r => [r.invoiceId,r.amount]), [[null,2750]]);
      const replacement = (await pool.query('SELECT * FROM payment_transactions WHERE id=$1',
        [result.allocation.allocations[0].transactionId])).rows[0];
      assert.equal(replacement.month,2);
      assert.equal(replacement.year,2026);
      const invoices = (await pool.query('SELECT id,amount_paid,status FROM invoices ORDER BY id')).rows;
      assert.deepEqual(invoices.map(r => [r.id,r.amount_paid,r.status]), [[10,'2350.00','Paid'],[11,'0.00','Unpaid']]);
      const audit = (await pool.query("SELECT details FROM audit_logs WHERE action='finance_payment_correction'")).rows[0].details;
      assert.equal(audit.reason,reason);
      assert.equal(audit.original_invoice_id,null);
      assert.equal(audit.original_amount,2350);
      assert.equal(audit.replacement_amount,2750);
      assert.equal(audit.replacement_allocations[0].invoiceId,null);
      const count = (await pool.query('SELECT COUNT(*) FROM payment_transactions')).rows[0].count;
      await transaction(c => commands.correctPayment({ executor:c,transactionId:source.id,
        amount:2750,paymentDate:'2026-01-13',actor,idempotencyKey:'preserve-credit' }));
      assert.equal((await pool.query('SELECT COUNT(*) FROM payment_transactions')).rows[0].count,count);
    });

    await t.test('an explicit invoice selection can allocate a corrected credit', async () => {
      await reset();
      const source = await credit(1150);
      const result = await transaction(c => commands.correctPayment({executor:c,
        transactionId:source.id,amount:1150,invoiceId:11,actor,reason}));
      assert.equal(result.allocation.allocations[0].invoiceId,11);
      assert.equal((await pool.query('SELECT amount_paid FROM invoices WHERE id=11')).rows[0].amount_paid,'1150.00');
    });

    await t.test('an allocated correction stays on its original invoice', async () => {
      await reset();
      const payment = await transaction(c => commands.recordPayment({executor:c,studentId:2,
        amount:800,invoiceId:11,paymentDate:'2026-01-13',reference:'TEST-ALLOCATED',actor}));
      const result = await transaction(c => commands.correctPayment({executor:c,
        transactionId:payment.allocations[0].transactionId,amount:700,actor,reason}));
      assert.equal(result.allocation.allocations[0].invoiceId,11);
      assert.equal((await pool.query('SELECT amount_paid FROM invoices WHERE id=11')).rows[0].amount_paid,'700.00');
    });

    await t.test('moving two mistaken allocations back to credit then applying the intended payment preserves history and totals', async () => {
      await reset();
      const sources = [];
      for (const value of [800,1550]) {
        const recorded = await transaction(c => commands.recordPayment({executor:c,studentId:2,
          amount:value,invoiceId:11,paymentDate:'2026-01-13',reference:`TEST-${value}`,actor}));
        sources.push(recorded.allocations[0].transactionId);
      }
      const intended = await credit(1150);
      const before = (await pool.query('SELECT * FROM payment_transactions ORDER BY id')).rows;
      const totalBefore = (await pool.query('SELECT SUM(amount) AS amount FROM payment_transactions')).rows[0].amount;
      const repair = async c => {
        for (const [index,value] of [800,1550].entries()) await commands.correctPayment({executor:c,
          transactionId:sources[index],amount:value,obligations:[],actor,reason,
          transactionMonth:index+2,transactionYear:2026,idempotencyKey:`repair-${index}`});
        await commands.applyCredit({executor:c,sourceTransactionId:intended.id,invoiceId:11,
          actor,description:reason,idempotencyKey:'repair-intended'});
      };
      const auditsBefore = (await pool.query('SELECT COUNT(*) FROM audit_logs')).rows[0].count;
      await assert.rejects(transaction(async c => {await repair(c);throw new Error('Late failure');}),/Late failure/);
      assert.deepEqual((await pool.query('SELECT * FROM payment_transactions ORDER BY id')).rows,before);
      assert.equal((await pool.query('SELECT COUNT(*) FROM audit_logs')).rows[0].count,auditsBefore);
      assert.equal((await pool.query('SELECT amount_paid FROM invoices WHERE id=11')).rows[0].amount_paid,'2350.00');
      await transaction(repair);
      assert.deepEqual((await pool.query('SELECT * FROM payment_transactions WHERE id=ANY($1::int[]) ORDER BY id',
        [before.map(r=>r.id)])).rows,before);
      assert.equal((await pool.query('SELECT SUM(amount) AS amount FROM payment_transactions')).rows[0].amount,totalBefore);
      assert.equal((await pool.query('SELECT amount_paid FROM invoices WHERE id=10')).rows[0].amount_paid,'2350.00');
      const october = (await pool.query('SELECT amount_due,amount_paid,status FROM invoices WHERE id=11')).rows[0];
      assert.deepEqual(october,{amount_due:'2350.00',amount_paid:'1150.00',status:'Partial'});
      assert.equal((await pool.query('SELECT SUM(amount) AS amount FROM payment_transactions WHERE invoice_id IS NULL')).rows[0].amount,'2350.00');
    });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
