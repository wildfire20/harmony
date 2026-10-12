const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const { authenticate, authorize } = require('../middleware/auth');
const service = require('../services/parentReRegistrationService');
const router = express.Router();
const parent = [authenticate, authorize('parent')];
const admin = [authenticate, authorize('admin','super_admin')];
const writeLimiter = rateLimit({ windowMs: 15*60*1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => String(req.user.id), message: { message: 'Too many requests. Please try again later.' } });
router.use((req, res, next) => {
  res.set('Cache-Control','no-store');
  if (['POST','PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ message: 'Please use the re-registration form.' });
  next();
});
const handle = operation => async (req, res) => {
  try { await operation(req, res); }
  catch (error) {
    if (['42P01','42703'].includes(error.code)) return res.status(503).json({ message: 'Online re-registration is not available yet. Please contact the school office.' });
    if (error.code === '23505' || error.code === '40P01') return res.status(409).json({ message: 'This form has changed. Please reload it before trying again.' });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('Parent re-registration request failed');
    res.status(500).json({ message: 'We could not save or load this form. Please try again.' });
  }
};
const documents = { complete: 'Harmony_2027_Re_registration_Complete.pdf', page1: 'Harmony_2027_Re_registration_Page_1.pdf', page2: 'Harmony_2027_Re_registration_Page_2.pdf' };
router.get('/forms/:document', authenticate, authorize('parent','admin','super_admin'), (req, res) => {
  const filename = documents[req.params.document];
  if (!filename) return res.status(404).json({ message: 'Form not found.' });
  res.download(path.join(__dirname,'..','assets','forms',filename), filename, error => {
    if (error && !res.headersSent) res.status(503).json({ message: 'The form download is unavailable. Please contact the school office.' });
  });
});
router.get('/admin', ...admin, handle(async (req,res) => res.json(await service.listRegistrations(req.user,req.query))));
router.get('/admin/pending-count', ...admin, handle(async (req,res) => res.json(await service.pendingCount(req.user))));
router.get('/admin/:studentId', ...admin, handle(async (req,res) => res.json(await service.getRegistration(req.params.studentId,req.user))));
router.post('/admin/:studentId/review', ...admin, writeLimiter, handle(async (req,res) => res.json(await service.reviewRegistration(req.params.studentId,req.user,req.body))));
router.get('/', ...parent, handle(async (req,res) => res.json(await service.getRegistration(req.query.child_id,req.user))));
router.post('/draft', ...parent, writeLimiter, handle(async (req,res) => res.json(await service.saveRegistration(req.query.child_id,req.user,req.body))));
router.post('/submit', ...parent, writeLimiter, handle(async (req,res) => res.json(await service.saveRegistration(req.query.child_id,req.user,req.body,true))));
module.exports = router;
