export const ADMISSIONS_STATUSES = [
  { value: 'NEW', label: 'New', tone: 'yellow' },
  { value: 'UNDER_REVIEW', label: 'Under Review', tone: 'blue' },
  { value: 'MORE_INFORMATION_REQUIRED', label: 'More Information Required', tone: 'orange' },
  { value: 'APPROVED', label: 'Approved', tone: 'green' },
  { value: 'REGISTRATION_PENDING', label: 'Registration Pending', tone: 'purple' },
  { value: 'REGISTERED', label: 'Registered', tone: 'emerald' },
  { value: 'NOT_ACCEPTED', label: 'Not Accepted', tone: 'red' },
];

export const LEGACY_STATUS_LABELS = {
  pending: 'Pending (legacy)',
  approved: 'Approved (legacy)',
  rejected: 'Not Accepted (legacy)',
  waitlisted: 'Waitlisted (legacy)',
};

export const statusLabel = (status) => (
  ADMISSIONS_STATUSES.find((item) => item.value === status)?.label
  || LEGACY_STATUS_LABELS[status]
  || status
);