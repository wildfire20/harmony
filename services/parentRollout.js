const { normalizePhone } = require('./parentAuth');

const activationStatus = (parent, duplicateIds) => {
  if (parent.is_active === false) return 'DISABLED';
  if (parent.activated_at || String(parent.parent_account_status || '').toLowerCase() === 'active') return 'ACTIVATED';
  if (!String(parent.phone_number || '').trim()) return 'MISSING_MOBILE';
  if (!normalizePhone(parent.phone_number)) return 'INVALID_MOBILE';
  if (duplicateIds.has(Number(parent.id))) return 'DUPLICATE_MOBILE';
  if (String(parent.parent_account_status || '').toLowerCase() === 'needs_review') return 'NEEDS_REVIEW';
  return 'READY_TO_ACTIVATE';
};

function buildParentRollout(parents, activationEvents = []) {
  const phoneGroups = new Map();
  parents.forEach((parent) => {
    const phone = normalizePhone(parent.phone_number);
    if (phone) phoneGroups.set(phone, [...(phoneGroups.get(phone) || []), parent]);
  });
  const duplicateIds = new Set([...phoneGroups.values()].filter(group => group.length > 1)
    .flatMap(group => group.map(parent => Number(parent.id))));
  const eventMap = new Map();
  activationEvents.forEach((event) => {
    const id = Number(event.entity_id);
    if (!eventMap.has(id)) eventMap.set(id, event);
  });
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday);
  startWeek.setDate(startToday.getDate() - 6);

  const rows = parents.map((parent) => {
    const rollout_status = activationStatus(parent, duplicateIds);
    const event = eventMap.get(Number(parent.id));
    const activation_method = event?.action === 'parent_self_activation_completed'
      ? 'SELF_EMAIL_OTP'
      : parent.activated_at ? 'ADMIN_EMAIL_LINK' : null;
    return {
      ...parent,
      linked_learner_count: Number(parent.linked_learner_count || parent.children?.length || 0),
      rollout_status,
      email_status: !String(parent.email || '').trim()
        ? 'MISSING'
        : parent.email_verified_at ? 'VERIFIED' : 'UNVERIFIED',
      account_state: parent.is_active === false ? 'DISABLED' : 'ACTIVE',
      activation_history: parent.activated_at ? [{
        activated_at: parent.activated_at,
        method: activation_method,
        email_verified: Boolean(parent.email_verified_at),
      }] : [],
    };
  });
  const activated = rows.filter(row => row.rollout_status === 'ACTIVATED');
  const needsAttention = rows.filter(row => [
    'INVALID_MOBILE', 'MISSING_MOBILE', 'DUPLICATE_MOBILE', 'NEEDS_REVIEW',
  ].includes(row.rollout_status)).length;
  return {
    parents: rows,
    metrics: {
      total: rows.length,
      activated: activated.length,
      awaiting_activation: rows.length - activated.length,
      ready_to_activate: rows.filter(row => row.rollout_status === 'READY_TO_ACTIVATE').length,
      needs_attention: needsAttention,
      disabled: rows.filter(row => row.rollout_status === 'DISABLED').length,
      activation_percentage: rows.length ? Number(((activated.length / rows.length) * 100).toFixed(1)) : 0,
      activated_today: activated.filter(row => new Date(row.activated_at) >= startToday).length,
      activated_this_week: activated.filter(row => new Date(row.activated_at) >= startWeek).length,
      never_activated: rows.filter(row => !row.activated_at).length,
      email_verified: rows.filter(row => row.email_status === 'VERIFIED').length,
      email_missing: rows.filter(row => row.email_status === 'MISSING').length,
      multi_learner_parents: rows.filter(row => row.linked_learner_count > 1).length,
    },
  };
}

module.exports = { activationStatus, buildParentRollout };