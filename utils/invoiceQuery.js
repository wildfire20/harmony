const INVOICE_STATUSES = ['Unpaid', 'Partial', 'Paid', 'Overpaid', 'Carried Forward'];
const SORT_FIELDS = ['due_date', 'amount_due', 'status', 'student_number', 'created_at'];

function optionalInteger(value, { name, min, max }) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Invalid invoice ${name} filter`);
  }
  return number;
}

function parseInvoiceListQuery(query = {}) {
  const status = query.status || undefined;
  if (status && !INVOICE_STATUSES.includes(status)) {
    throw new Error('Invalid invoice status filter');
  }
  const month = optionalInteger(query.month, { name: 'month', min: 1, max: 12 });
  const year = optionalInteger(query.year, { name: 'year', min: 1900, max: 2200 });
  const page = optionalInteger(query.page == null ? 1 : query.page, {
    name: 'page', min: 1, max: Number.MAX_SAFE_INTEGER,
  });
  const limit = optionalInteger(query.limit == null ? 50 : query.limit, {
    name: 'limit', min: 1, max: 100,
  });
  const sortBy = SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'due_date';
  const requestedOrder = String(query.sortOrder || 'DESC').toUpperCase();
  const sortOrder = ['ASC', 'DESC'].includes(requestedOrder) ? requestedOrder : 'DESC';
  return {
    status,
    month,
    year,
    studentNumber: query.studentNumber ? String(query.studentNumber).trim() : undefined,
    page,
    limit,
    sortBy,
    sortOrder,
  };
}

function appendPeriodFilters(clauses, params, dateExpression, { month, year } = {}) {
  const parsedMonth = optionalInteger(month, { name: 'month', min: 1, max: 12 });
  const parsedYear = optionalInteger(year, { name: 'year', min: 1900, max: 2200 });
  if (parsedMonth != null) {
    params.push(parsedMonth);
    clauses.push(`EXTRACT(MONTH FROM ${dateExpression}) = $${params.length}`);
  }
  if (parsedYear != null) {
    params.push(parsedYear);
    clauses.push(`EXTRACT(YEAR FROM ${dateExpression}) = $${params.length}`);
  }
}

module.exports = {
  INVOICE_STATUSES,
  parseInvoiceListQuery,
  appendPeriodFilters,
};