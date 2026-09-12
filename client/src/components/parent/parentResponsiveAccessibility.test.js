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
  expect(login).toMatch(/className="parent-remember"/);
  expect(source('ParentPortal.css')).toMatch(/\.parent-remember:checked/);
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
  expect(css).not.toMatch(/#4f46e5|#6366f1|linear-gradient\([^)]*(blue|purple|indigo)/i);
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
  expect(proof).toMatch(/bg-\[#2c7475\]/);
  expect(proof).not.toMatch(/bg-blue-(50|100|600)|text-blue-(600|700|800)|border-blue-(100|200|500)/);
});

test('legacy Grades URLs redirect without changing startup session hydration', () => {
  const portal = source('ParentPortal.js');
  expect(portal).toMatch(/<Route path="grades"\s+element={<Navigate to="\/parent\/dashboard" replace \/>} \/>/);
  expect(portal).toMatch(/refreshParentAccess\(\)\.catch/);
  expect(portal).toMatch(/setAuthVersion\(version => version \+ 1\)/);
  expect(portal).toMatch(/fetch\('\/api\/parent\/me', \{ credentials: 'include'/);
});