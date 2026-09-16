const isCurrentBillingReadinessResponse = ({
  requestId,
  latestRequestId,
  requestedPeriod,
  responsePeriod,
}) => requestId === latestRequestId && responsePeriod === requestedPeriod;

const isBillingReadinessReady = ({ readiness, loading, selectedPeriod }) =>
  loading === false &&
  readiness?.ready === true &&
  readiness?.period === selectedPeriod;

module.exports = {
  isCurrentBillingReadinessResponse,
  isBillingReadinessReady,
};