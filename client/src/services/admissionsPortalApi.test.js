import fs from 'fs';
import path from 'path';

describe('admissions portal API client', () => {
  const source = fs.readFileSync(path.join(__dirname, 'admissionsPortalApi.js'), 'utf8');
  const executableSource = source.replace(/\/\/.*$/gm, '');

  test('uses a dedicated same-origin client without stored credentials or auth interceptors', () => {
    expect(executableSource).toMatch(/axios\.create\(\{\s*baseURL: '\/api',\s*timeout: 30000,\s*\}\)/);
    expect(executableSource).not.toMatch(/localStorage|sessionStorage|Authorization|interceptors|withCredentials/);
    expect(executableSource).not.toMatch(/console\.|analytics|gtag|posthog/i);
  });

  test('encodes the route token and never places it in request bodies', () => {
    expect(executableSource.match(/encodeURIComponent\(token\)/g)).toHaveLength(8);
    expect(executableSource).not.toMatch(/\{\s*token\s*[,}]/);
  });
});