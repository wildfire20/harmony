// November 2026 onward uses the school's approved R150 sibling discount.
// Keep the earlier policy for historical previews; existing invoices are never repriced.
function siblingDiscountAmount(period) {
  return String(period).slice(0, 7) >= '2026-11' ? 150 : 100;
}

module.exports = { siblingDiscountAmount };
