const isStudentPortalEnabled = () => {
  const configuredValue = process.env.STUDENT_PORTAL_ENABLED;
  if (configuredValue === undefined) return true;
  return configuredValue.trim().toLowerCase() !== 'false';
};

const isParentSelfActivationEnabled = () =>
  String(process.env.PARENT_SELF_ACTIVATION_ENABLED || '').trim().toLowerCase() === 'true';

module.exports = {
  isStudentPortalEnabled,
  isParentSelfActivationEnabled,
};