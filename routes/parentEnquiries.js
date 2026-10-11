const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, authorize } = require('../middleware/auth');
const service = require('../services/parentEnquiryService');
const router = express.Router();
const parent = [authenticate, authorize('parent')];
const admin = [authenticate, authorize('admin', 'super_admin')];
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true,
  legacyHeaders: false, message: { message: 'Too many enquiries. Please try again later.' } });
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true,
  legacyHeaders: false, keyGenerator: req => String(req.user.id),
  message: { message: 'Too many requests. Please try again later.' } });
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ message: 'Please use the enquiry form to submit your message.' });
  }
  next();
});
const handle = operation => async (req, res) => {
  try { await operation(req, res); }
  catch (error) {
    if (['42P01', '42703'].includes(error.code)) return res.status(503).json({ message: 'Enquiries are not available yet. Please contact the school office.' });
    if (error.code === '23505') return res.status(409).json({ message: 'This request has changed. Please refresh and try again.' });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('Parent enquiry request failed');
    res.status(500).json({ message: 'We could not save or load this enquiry. Please try again.' });
  }
};
router.post('/help', publicLimiter, handle(async (req, res) => {
  const result = await service.createEnquiry(req.body);
  res.status(result.duplicate ? 200 : 201).json({ ...result,
    message: 'Your enquiry has been sent. The school office will contact you using the mobile number provided.' });
}));
router.get('/admin', ...admin, handle(async (req, res) => res.json(await service.listEnquiries(req.user, req.query))));
router.get('/admin/:id', ...admin, handle(async (req, res) => res.json(await service.getEnquiry(req.params.id, req.user))));
router.post('/admin/:id/replies', ...admin, writeLimiter, handle(async (req, res) => {
  res.json({ ...await service.changeEnquiry(req.params.id, req.user, req.body), message: 'Reply sent.' });
}));
router.patch('/admin/:id/status', ...admin, writeLimiter, handle(async (req, res) => {
  res.json({ ...await service.changeEnquiry(req.params.id, req.user, req.body, true), message: 'Status updated.' });
}));
router.get('/', ...parent, handle(async (req, res) => res.json(await service.listEnquiries(req.user, req.query))));
router.post('/', ...parent, writeLimiter, handle(async (req, res) => {
  const result = await service.createEnquiry(req.body, req.user);
  res.status(result.duplicate ? 200 : 201).json({ ...result, message: 'Your enquiry has been sent. Replies will appear here.' });
}));
router.get('/:id', ...parent, handle(async (req, res) => res.json(await service.getEnquiry(req.params.id, req.user))));
router.post('/:id/replies', ...parent, writeLimiter, handle(async (req, res) => {
  res.json({ ...await service.changeEnquiry(req.params.id, req.user, req.body), message: 'Reply sent.' });
}));
module.exports = router;
