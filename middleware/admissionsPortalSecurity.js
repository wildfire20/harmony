const rateLimit = require('express-rate-limit');

const portalReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many secure portal requests. Please try again later.' },
});

const portalWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many secure portal updates. Please try again later.' },
});

const tokenSafeRequestLogger = (req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.info('Admissions portal request', {
      method: req.method,
      route: '/api/admissions-portal/[REDACTED]',
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
};

const securePortalHeaders = (req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Cache-Control', 'no-store');
  next();
};

module.exports = {
  portalReadLimiter,
  portalWriteLimiter,
  securePortalHeaders,
  tokenSafeRequestLogger,
};