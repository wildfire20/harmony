const isStudentPortalEnabled = () => {
  const configuredValue = process.env.STUDENT_PORTAL_ENABLED;
  if (configuredValue === undefined) return true;
  return configuredValue.trim().toLowerCase() !== 'false';
};

const isParentSelfActivationEnabled = () =>
  String(process.env.PARENT_SELF_ACTIVATION_ENABLED || '').trim().toLowerCase() === 'true';

const parentSelfActivationPilot = () => {
  const raw = String(process.env.PARENT_SELF_ACTIVATION_PILOT_PARENT_IDS || '').trim();
  const ids = new Set(raw.split(',').map(value => value.trim())
    .filter(value => /^\d+$/.test(value) && Number(value) > 0)
    .map(Number));
  return { restricted: raw.length > 0, ids };
};

const isParentSelfActivationPilotParentAllowed = (parentId) => {
  const pilot = parentSelfActivationPilot();
  return !pilot.restricted || pilot.ids.has(Number(parentId));
};

module.exports = {
  isStudentPortalEnabled,
  isParentSelfActivationEnabled,
  isParentSelfActivationPilotParentAllowed,
};