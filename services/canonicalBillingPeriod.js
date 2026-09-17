const CANONICAL_BILLING_START_PERIOD = '2026-10';

function isBeforeCanonicalBillingStart(period) {
  return String(period || '') < CANONICAL_BILLING_START_PERIOD;
}

module.exports = {
  CANONICAL_BILLING_START_PERIOD,
  isBeforeCanonicalBillingStart,
};