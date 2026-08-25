const isStudentPortalEnabled = () => {
  const configuredValue = process.env.STUDENT_PORTAL_ENABLED;
  if (configuredValue === undefined) return true;
  return configuredValue.trim().toLowerCase() !== 'false';
};

module.exports = {
  isStudentPortalEnabled,
};