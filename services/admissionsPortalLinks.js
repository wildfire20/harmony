const CANONICAL_PRODUCTION_URL = 'https://www.harmonylearning.co.za';

class PortalLinkConfigurationError extends Error {
  constructor() {
    super('PORTAL_CANONICAL_URL_INVALID');
    this.name = 'PortalLinkConfigurationError';
    this.code = 'PORTAL_CANONICAL_URL_INVALID';
  }
}

const getCanonicalProductionUrl = (environment = process.env) => {
  const configured = String(environment.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(configured);
    if (
      parsed.origin !== CANONICAL_PRODUCTION_URL
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || parsed.username
      || parsed.password
    ) throw new PortalLinkConfigurationError();
    return CANONICAL_PRODUCTION_URL;
  } catch (error) {
    if (error instanceof PortalLinkConfigurationError) throw error;
    throw new PortalLinkConfigurationError();
  }
};

const buildPortalLink = ({ token, purpose, environment = process.env }) => {
  if (typeof token !== 'string' || token.length < 40 || token.length > 128) {
    throw new TypeError('A valid secure portal token is required');
  }
  const baseUrl = getCanonicalProductionUrl(environment);
  const route = purpose === 'UPDATE_APPLICATION' ? '/application/update/' : purpose === 'COMPLETE_REGISTRATION'
    ? '/registration/'
    : null;
  if (!route) throw new TypeError('A valid portal purpose is required');
  return `${baseUrl}${route}${encodeURIComponent(token)}`;
};

module.exports = {
  CANONICAL_PRODUCTION_URL,
  PortalLinkConfigurationError,
  buildPortalLink,
  getCanonicalProductionUrl,
};