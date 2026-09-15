const repository = require('./serviceEnrollmentRepository');

async function getBillingEnrollments(learnerId, billingPeriod, executor) {
  return repository.listEffectiveEnrollments(learnerId, billingPeriod, executor);
}

async function getBillingEnrollmentsForLearners(learnerIds, billingPeriod, executor) {
  return repository.listEffectiveEnrollmentsForStudents(learnerIds, billingPeriod, executor);
}

async function enrollLearner(input, executor) {
  return repository.createEnrollment(input, executor);
}

async function endLearnerEnrollment(enrollmentId, effectiveEnd, executor) {
  return repository.endEnrollment(enrollmentId, effectiveEnd, executor);
}

module.exports = {
  ...repository,
  getBillingEnrollments,
  getBillingEnrollmentsForLearners,
  getEffectiveEnrollments: getBillingEnrollments,
  getEffectiveEnrollmentsForLearners: getBillingEnrollmentsForLearners,
  getServiceEnrollmentsForPeriod: getBillingEnrollments,
  enrollLearner,
  createServiceEnrollment: enrollLearner,
  endLearnerEnrollment,
};