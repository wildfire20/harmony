import fs from 'fs';
import path from 'path';

describe('admin admissions API helpers', () => {
  const source = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  const modalSource = fs.readFileSync(path.join(__dirname, '../components/admin/EnrollmentManagement.js'), 'utf8');

  test('exposes the information request and secure-link lifecycle routes', () => {
    expect(source).toMatch(/requestInformation:\s*\(id, data\)\s*=>\s*api\.post\(`\/enrollments\/\$\{id\}\/information-request`, data\)/);
    expect(source).toMatch(/resendPortalLink:\s*\(id, data\)\s*=>\s*api\.post\(`\/enrollments\/\$\{id\}\/portal-link\/resend`, data\)/);
    expect(source).toMatch(/reissuePortalLink:\s*\(id, data\)\s*=>\s*api\.post\(`\/enrollments\/\$\{id\}\/portal-link\/reissue`, data\)/);
    expect(source).toMatch(/revokePortalLink:\s*\(id, data\)\s*=>\s*api\.post\(`\/enrollments\/\$\{id\}\/portal-link\/revoke`, data\)/);
    expect(source).toMatch(/updateChecklistItem:\s*\(id, itemType, data\)\s*=>\s*api\.patch\(`\/enrollments\/\$\{id\}\/checklist\/\$\{encodeURIComponent\(itemType\)\}`, data\)/);
    expect(source).toMatch(/resendEmail:\s*\(id, data\)\s*=>\s*api\.post\(`\/enrollments\/\$\{id\}\/email\/resend`, data\)/);
  });

  test('keeps normal status updates on the existing endpoint', () => {
    expect(source).toMatch(/updateStatus:\s*\(id, data\)\s*=>\s*api\.put\(`\/enrollments\/\$\{id\}\/status`, data\)/);
  });

  test('routes checklist payloads through the item-specific PATCH helper', () => {
    expect(modalSource).toMatch(/updateChecklistItem\(selectedEnrollment\.id, itemType, \{ status \}\)/);
    expect(modalSource).toMatch(/onChange=\{\(event\) => updateChecklist\(item\.itemType, event\.target\.value\)\}/);
    expect(modalSource).toMatch(/ADMIN_CHECKLIST_STATES/);
  });

  test('protects submitted read-only links and keeps request flow previewable', () => {
    expect(modalSource).toMatch(/link\.status === 'SUBMITTED_READ_ONLY'/);
    expect(modalSource).toMatch(/Link cannot be resent or reissued/);
    expect(modalSource).toMatch(/setRequestPreview\(true\)/);
    expect(modalSource).toMatch(/Send request information/);
  });
});