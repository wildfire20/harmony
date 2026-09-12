import fs from 'fs';
import path from 'path';

const source = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');

test('parent navigation keeps grades out of visible navigation', () => {
  const portal = source('ParentPortal.js');
  expect(portal).not.toMatch(/\{ path: ['"]\/parent\/grades['"]/);
  expect(portal).toMatch(/label: 'Attendance'/);
  expect(portal).toMatch(/label: 'Account'/);
  expect(portal).toMatch(/label: 'Notifications'/);
  expect(portal).toMatch(/MOBILE_NAV_PATHS\.has\(path\)/);
});

test('parent login remember control exposes a visible accessible state', () => {
  const login = source('ParentLogin.js');
  expect(login).toMatch(/aria-label="Keep me signed in on this device"/);
  expect(login).toMatch(/checked=\{remember\}/);
  expect(login).toMatch(/onChange=\{e => setRemember\(e\.target\.checked\)\}/);
  expect(login).toMatch(/className="parent-remember"/);
  expect(login).toMatch(/remember && <Check/);
  expect(login).toMatch(/parent-remember-control \$\{remember \? 'is-checked'/);
  expect(source('ParentPortal.css')).toMatch(/\.parent-remember-control\.is-checked/);
  expect(source('ParentPortal.css')).toMatch(/\.parent-remember:focus-visible \+ \.parent-remember-control/);
});

test('parent surfaces include a narrow viewport layout and original logo asset', () => {
  const css = source('ParentPortal.css');
  expect(css).toMatch(/@media \(max-width: 639px\)/);
  expect(css).toMatch(/env\(safe-area-inset-bottom\)/);
  expect(css).toMatch(/\.parent-mobile-menu[\s\S]*background: var\(--parent-surface\)/);
  expect(source('ParentLogin.js')).toMatch(/\/images\/harmony-logo\.png/);
  expect(source('ParentPortal.js')).toMatch(/\/images\/harmony-logo\.png/);
});

test('mobile navigation cannot fall back to the legacy blue-purple treatment', () => {
  const css = source('ParentPortal.css');
  const portal = source('ParentPortal.js');
  expect(portal).toMatch(/parent-mobile-header/);
  expect(portal).toMatch(/parent-mobile-bottom-nav/);
  expect(portal).toMatch(/parent-mobile-bottom-item/);
  expect(css).toMatch(/\.parent-mobile-bottom-nav[\s\S]*background: rgba\(255,255,255,.98\) !important/);
  expect(css).toMatch(/\.parent-mobile-bottom-item[\s\S]*background-image: none !important/);
  expect(css).toMatch(/\.parent-mobile-header[\s\S]*background: var\(--parent-navy\) !important/);
  expect(css).toMatch(/\.parent-header-action[\s\S]*background: transparent !important/);
  expect(portal).toMatch(/parent-header-signout/);
  expect(css).toMatch(/\.parent-child-switcher[\s\S]*background: #f6f8f6 !important/);
  expect(css).toMatch(/\.parent-signout[\s\S]*background: var\(--parent-surface\) !important/);
  expect(source('ParentAccount.js')).toMatch(/parent-account-signout/);
  expect(css).toMatch(/\.parent-account-signout[\s\S]*background: var\(--parent-navy\) !important/);
  expect(css).toMatch(/button\.parent-header-action:hover[\s\S]*background: rgba\(255,255,255,.1\) !important/);
  expect(css).toMatch(/button\.parent-account-signout:hover[\s\S]*background: var\(--parent-navy-deep\) !important/);
  expect(css).toMatch(/button\.parent-signout:hover[\s\S]*background: #fff7f5 !important/);
  expect(css).toMatch(/button\.parent-child-switcher:hover[\s\S]*background: #e8f1ef !important/);
  expect(css).toMatch(/button\.parent-menu-active:hover[\s\S]*background: var\(--parent-teal\) !important/);
  expect(css).toMatch(/button\.parent-mobile-bottom-item:hover[\s\S]*background: #edf3f1 !important/);
  expect(css).not.toMatch(/#4f46e5|#6366f1|linear-gradient\([^)]*(blue|purple|indigo)/i);
});

test('all authenticated Parent Portal surfaces avoid saturated blue-purple utility colors', () => {
  const authenticated = [
    'ParentPortal.js', 'ParentDashboard.js', 'ParentAttendance.js',
    'ParentAnnouncements.js', 'ParentDocuments.js', 'ParentInvoices.js',
    'ParentNotifications.js', 'ParentAccount.js', 'ParentPaymentProof.js',
  ].map(source).join('\n');
  expect(authenticated).not.toMatch(
    /(?:bg|text|border|ring|from|via|to)-(?:blue|indigo|violet)-(?:50|100|200|300|400|500|600|700|800|900)/,
  );
});

test('parent login checks the refresh session before rendering the form', () => {
  const login = source('ParentLogin.js');
  expect(login).toMatch(/const \[checkingSession, setCheckingSession\] = useState\(true\)/);
  expect(login).toMatch(/refreshParentAccess\(\)[\s\S]*navigate\(getReturnDestination/);
  expect(login).toMatch(/if \(checkingSession\)[\s\S]*Checking your Parent Portal session/);
  expect(login.indexOf('if (checkingSession)')).toBeLessThan(login.indexOf('<form onSubmit={handleSubmit}'));
});

test('parent login uses the current activation and staff-only wording', () => {
  const login = source('ParentLogin.js');
  expect(login).toMatch(/First time using the Parent Portal\?/);
  expect(login).toMatch(/Activate your account\./);
  expect(login).toMatch(/navigate\('\/parent\/activate'\)/);
  expect(login).toMatch(/Use the Staff Portal/);
  expect(login).not.toMatch(/temporary password|staff\/student portal|studentPortalEnabled/i);
});

test('embedded payment proof uses the restrained Parent Portal palette', () => {
  const proof = source('ParentPaymentProof.js');
  expect(proof).toMatch(/parent-payment-primary/);
  expect(source('ParentPortal.css')).toMatch(/button\.parent-payment-primary[\s\S]*background: var\(--parent-teal\) !important/);
  expect(proof).not.toMatch(/bg-blue-(50|100|600)|text-blue-(600|700|800)|border-blue-(100|200|500)/);
});

test('Parent login and authenticated action buttons are isolated from legacy dark-theme purple', () => {
  const css = source('ParentPortal.css');
  const login = source('ParentLogin.js');
  expect(css).toMatch(/--harmony-primary: var\(--parent-teal\)/);
  expect(css).toMatch(/\[data-theme="dark"\] \.parent-login button[\s\S]*background: transparent !important/);
  expect(css).toMatch(/button\.parent-login-submit[\s\S]*background: var\(--parent-teal\) !important/);
  expect(css).toMatch(/button\.parent-announcement-card[\s\S]*background: var\(--parent-surface\) !important/);
  expect(login).toMatch(/parent-login-submit/);
  expect(login).toMatch(/parent-password-toggle/);
  expect(login).toMatch(/parent-login-link/);
});

test('fees service cards wrap safely and collapse to one column on narrow phones', () => {
  const invoices = source('ParentInvoices.js');
  const css = source('ParentPortal.css');
  expect(invoices).toMatch(/parent-service-grid/);
  expect(invoices).toMatch(/parent-service-card flex min-w-0/);
  expect(invoices).toMatch(/parent-service-name flex min-w-0/);
  expect(css).toMatch(/\.parent-service-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  expect(css).toMatch(/@media \(max-width: 389px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test('legacy Grades URLs redirect without changing startup session hydration', () => {
  const portal = source('ParentPortal.js');
  expect(portal).toMatch(/<Route path="grades"\s+element={<Navigate to="\/parent\/dashboard" replace \/>} \/>/);
  expect(portal).toMatch(/refreshParentAccess\(\)\.catch/);
  expect(portal).toMatch(/setAuthVersion\(version => version \+ 1\)/);
  expect(portal).toMatch(/fetch\('\/api\/parent\/me', \{ credentials: 'include'/);
});