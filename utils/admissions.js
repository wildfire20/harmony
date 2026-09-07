const crypto = require('crypto');

const ADMISSIONS_STATUSES = Object.freeze([
  'NEW',
  'UNDER_REVIEW',
  'MORE_INFORMATION_REQUIRED',
  'APPROVED',
  'REGISTRATION_PENDING',
  'REGISTERED',
  'NOT_ACCEPTED',
]);

const STATUS_LABELS = Object.freeze({
  NEW: 'New',
  UNDER_REVIEW: 'Under Review',
  MORE_INFORMATION_REQUIRED: 'More Information Required',
  APPROVED: 'Approved',
  REGISTRATION_PENDING: 'Registration Pending',
  REGISTERED: 'Registered',
  NOT_ACCEPTED: 'Not Accepted',
  pending: 'Pending (legacy)',
  approved: 'Approved (legacy)',
  rejected: 'Not Accepted (legacy)',
  waitlisted: 'Waitlisted (legacy)',
});

const generateRegistrationToken = () => crypto.randomBytes(32).toString('base64url');
const hashRegistrationToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const registrationTokenExpiry = (issuedAt = new Date()) => new Date(issuedAt.getTime() + (7 * 24 * 60 * 60 * 1000));

module.exports = {
  ADMISSIONS_STATUSES,
  STATUS_LABELS,
  generateRegistrationToken,
  hashRegistrationToken,
  registrationTokenExpiry,
};