const express = require('express');
const {
  portalReadLimiter,
  portalWriteLimiter,
  tokenSafeRequestLogger,
} = require('../middleware/admissionsPortalSecurity');
const { requireAdmissionsPortalSchema } = require('../middleware/admissionsPortalSchema');

const router = express.Router();

router.use(tokenSafeRequestLogger);
router.use(portalReadLimiter);
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return portalWriteLimiter(req, res, next);
  }
  return next();
});
router.use(requireAdmissionsPortalSchema);

// Parent-facing endpoints are intentionally deferred to Phase 3.
router.use((req, res) => res.status(404).json({ message: 'Secure portal endpoint not found.' }));

module.exports = router;