const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateReceiptFile,
  isAllowedReceiptName,
  MAX_RECEIPT_SIZE,
} = require('../routes/paymentProofs');

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

test('payment receipt upload rejects MIME and extension mismatches', () => {
  assert.equal(isAllowedReceiptName({ originalname: 'receipt.exe', mimetype: 'application/pdf' }), false);
  assert.equal(isAllowedReceiptName({ originalname: 'receipt.pdf', mimetype: 'image/png' }), false);
});

test('payment receipt upload rejects a bad signature', () => {
  const result = validateReceiptFile({
    originalname: 'receipt.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('<html>not a receipt</html>'),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /valid PDF/);
});

test('payment receipt upload rejects an oversized payload', () => {
  const result = validateReceiptFile({
    originalname: 'receipt.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.alloc(MAX_RECEIPT_SIZE + 1),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /no larger than 10MB/);
});

test('payment receipt upload accepts a matching PDF signature and MIME', () => {
  assert.equal(validateReceiptFile({
    originalname: 'receipt.pdf',
    mimetype: 'application/pdf',
    buffer: pdf,
  }).ok, true);
});