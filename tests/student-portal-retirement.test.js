const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  send(payload) {
    this.body = payload;
    return this;
  },
  setHeader() {},
});

test('student portal flag defaults on and only false disables it', () => {
  const previous = process.env.STUDENT_PORTAL_ENABLED;
  const { isStudentPortalEnabled } = require('../config/features');

  delete process.env.STUDENT_PORTAL_ENABLED;
  assert.equal(isStudentPortalEnabled(), true);
  process.env.STUDENT_PORTAL_ENABLED = 'true';
  assert.equal(isStudentPortalEnabled(), true);
  process.env.STUDENT_PORTAL_ENABLED = 'FALSE';
  assert.equal(isStudentPortalEnabled(), false);

  if (previous === undefined) delete process.env.STUDENT_PORTAL_ENABLED;
  else process.env.STUDENT_PORTAL_ENABLED = previous;
});

test('deployment example configures the retired state', () => {
  const envExample = read('.env.example');
  assert.match(envExample, /^STUDENT_PORTAL_ENABLED=false$/m);
});

test('disabled student login is rejected before learner lookup or JWT creation', () => {
  const auth = read('routes/auth.js');
  const studentRoute = auth.slice(
    auth.indexOf("router.post('/login/student'"),
    auth.indexOf('// Teacher/Admin login')
  );

  const guard = studentRoute.indexOf('!isStudentPortalEnabled()');
  assert.ok(guard >= 0);
  assert.ok(guard < studentRoute.indexOf('db.query'));
  assert.ok(guard < studentRoute.indexOf('generateToken'));
  assert.match(studentRoute, /Student Portal access is currently unavailable/);

  assert.match(auth, /router\.post\('\/login\/staff'/);
  assert.match(auth, /router\.post\('\/login\/parent'/);
});

test('disabled student login returns 403 without querying the database', async () => {
  const previous = process.env.STUDENT_PORTAL_ENABLED;
  const db = require('../config/database');
  const originalQuery = db.query;
  let queryCalls = 0;
  let server;

  process.env.STUDENT_PORTAL_ENABLED = 'false';
  db.query = async () => {
    queryCalls += 1;
    throw new Error('Student login must not query the database when disabled');
  };

  try {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_number: 'not-looked-up', password: 'not-looked-up' }),
    });

    assert.equal(response.status, 403);
    assert.equal(queryCalls, 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.query = originalQuery;
    if (previous === undefined) delete process.env.STUDENT_PORTAL_ENABLED;
    else process.env.STUDENT_PORTAL_ENABLED = previous;
  }
});

test('central authentication rejects student JWTs but accepts adult JWTs', async () => {
  const authMiddleware = read('middleware/auth.js');
  const roleGuard = /req\.user\.role === 'student' && !isStudentPortalEnabled\(\)/;
  assert.match(authMiddleware, roleGuard);
  assert.ok(authMiddleware.indexOf("req.user.role === 'student'") < authMiddleware.indexOf('next();'));
  assert.doesNotMatch(authMiddleware, /req\.user\.role !== '(admin|teacher|parent)'/);

  const previous = process.env.STUDENT_PORTAL_ENABLED;
  const jwt = require('jsonwebtoken');
  const db = require('../config/database');
  const originalVerify = jwt.verify;
  const originalQuery = db.query;
  const { authenticate } = require('../middleware/auth');

  process.env.STUDENT_PORTAL_ENABLED = 'false';
  jwt.verify = () => ({ id: 42 });

  try {
    for (const [role, expectedStatus, expectedNext] of [
      ['student', 403, false],
      ['teacher', 200, true],
      ['admin', 200, true],
      ['parent', 200, true],
    ]) {
      db.query = async () => ({ rows: [{ id: 42, role, is_active: true }] });
      const req = {
        headers: { authorization: 'Bearer signed-test-token' },
        header(name) {
          return this.headers[name.toLowerCase()];
        },
      };
      const res = createResponse();
      let nextCalled = false;

      await authenticate(req, res, () => {
        nextCalled = true;
      });

      assert.equal(res.statusCode, expectedStatus, `${role} status`);
      assert.equal(nextCalled, expectedNext, `${role} next() behavior`);
    }
  } finally {
    jwt.verify = originalVerify;
    db.query = originalQuery;
    if (previous === undefined) delete process.env.STUDENT_PORTAL_ENABLED;
    else process.env.STUDENT_PORTAL_ENABLED = previous;
  }
});

test('server exposes the non-secret flag state to the frontend', () => {
  const server = read('server.js');
  assert.match(server, /app\.get\('\/api\/config\/public'/);
  assert.match(server, /studentPortalEnabled:\s*isStudentPortalEnabled\(\)/);

  const context = read('client/src/contexts/AppConfigContext.js');
  assert.match(context, /publicConfigAPI\.get\(\)/);
  assert.match(context, /studentPortalEnabled/);
});

test('public student portal entry points are removed without deleting direct retirement handling', () => {
  const landing = read('client/src/components/public/LandingPage.js');
  const login = read('client/src/components/auth/Login.js');
  const app = read('client/src/App.js');
  const authContext = read('client/src/contexts/AuthContext.js');

  assert.doesNotMatch(landing, /title="Student Portal"/);
  assert.doesNotMatch(landing, />Student Portal<\/Link>/);
  assert.match(landing, /title="Parent Portal"/);
  assert.match(landing, /title="Staff Portal"/);
  assert.match(login, /!studentPortalEnabled && requestedStudentPortal/);
  assert.match(login, /Student Portal unavailable/);
  assert.match(app, /user\.role === 'student' && !studentPortalEnabled/);
  assert.match(app, /studentPortalBlocked[\s\S]{0,120}login\?type=student/);
  assert.match(authContext, /Student Portal access is currently unavailable/);

  assert.equal(fs.existsSync(path.join(root, 'client/src/components/dashboard/StudentDashboard.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'client/src/components/quizzes/QuizPlayer.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'client/src/components/tasks/TaskDetails.js')), true);
});

test('learner creation remains intact but credentials are not distributed when disabled', () => {
  const admin = read('routes/admin.js');
  const submissions = read('routes/submissions.js');

  assert.match(admin, /INSERT INTO users \(student_number, first_name, last_name, grade_id, class_id, password, role, email\)/);
  assert.match(admin, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, 'student', \$7\)/);
  assert.match(admin, /bcrypt\.hash\(temporaryPassword/);
  assert.match(admin, /isStudentPortalEnabled\(\) \? \{ generated_password: temporaryPassword \} : \{\}/);
  assert.match(admin, /Student credential export is unavailable/);
  assert.doesNotMatch(admin, /STUDENT_PORTAL_ENABLED[\s\S]{0,300}is_active\s*=\s*false/);
  assert.doesNotMatch(submissions, /create-students/);
  assert.doesNotMatch(submissions, /student number as password/);
});

test('student password controls are disabled while adult password workflows remain', () => {
  const routes = read('routes/passwords.js');
  const component = read('client/src/components/admin/PasswordManagement.js');
  const parent = read('routes/parent.js');

  assert.match(routes, /user\.role === 'student' && !isStudentPortalEnabled\(\)/);
  assert.match(routes, /router\.get\('\/teachers'/);
  assert.match(component, /studentPortalEnabled && <button/);
  assert.match(component, /enabled: studentPortalEnabled && activeTab === 'students'/);
  assert.match(parent, /router\.post\('\/admin\/reset-password\/:parentId'/);
});

test('disabled credential export returns before querying the database', async () => {
  const previous = process.env.STUDENT_PORTAL_ENABLED;
  const db = require('../config/database');
  const originalQuery = db.query;
  const adminRouter = require('../routes/admin');
  const exportRoute = adminRouter.stack.find((layer) => layer.route?.path === '/students/export-credentials');
  const handler = exportRoute.route.stack.at(-1).handle;
  let queryCalls = 0;

  process.env.STUDENT_PORTAL_ENABLED = 'false';
  db.query = async () => {
    queryCalls += 1;
    throw new Error('Credential export must not query when disabled');
  };

  try {
    const res = createResponse();
    await handler({ query: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(queryCalls, 0);
  } finally {
    db.query = originalQuery;
    if (previous === undefined) delete process.env.STUDENT_PORTAL_ENABLED;
    else process.env.STUDENT_PORTAL_ENABLED = previous;
  }
});

test('disabled mixed bulk reset skips students and still resets teachers', async () => {
  const previous = process.env.STUDENT_PORTAL_ENABLED;
  const db = require('../config/database');
  const bcrypt = require('bcryptjs');
  const originalQuery = db.query;
  const originalHash = bcrypt.hash;
  const passwordRouter = require('../routes/passwords');
  const bulkRoute = passwordRouter.stack.find((layer) => layer.route?.path === '/bulk-reset');
  const handler = bulkRoute.route.stack.at(-1).handle;
  const updatedIds = [];

  process.env.STUDENT_PORTAL_ENABLED = 'false';
  bcrypt.hash = async () => 'secure-test-hash';
  db.query = async (sql, params) => {
    if (sql.includes('SELECT id, first_name, last_name, role, student_number')) {
      const id = params[0];
      return {
        rows: [{
          id,
          first_name: id === 10 ? 'Learner' : 'Teacher',
          last_name: 'Test',
          role: id === 10 ? 'student' : 'teacher',
        }],
      };
    }
    if (sql.includes('UPDATE users SET password')) {
      updatedIds.push(params[1]);
      return { rows: [] };
    }
    throw new Error(`Unexpected query in bulk reset test: ${sql}`);
  };

  try {
    const res = createResponse();
    await handler({ body: { userIds: [10, 20] } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(updatedIds, [20]);
    assert.deepEqual(res.body.data.results.map((result) => result.id), [20]);
  } finally {
    bcrypt.hash = originalHash;
    db.query = originalQuery;
    if (previous === undefined) delete process.env.STUDENT_PORTAL_ENABLED;
    else process.env.STUDENT_PORTAL_ENABLED = previous;
  }
});

test('shared learner records and adult-facing modules remain present', () => {
  for (const file of [
    'routes/parent.js',
    'routes/attendance.js',
    'routes/invoices.js',
    'routes/tasks.js',
    'routes/quizzes.js',
    'routes/submissions.js',
    'routes/documents.js',
    'routes/announcements.js',
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must remain present`);
  }

  const parent = read('routes/parent.js');
  assert.match(parent, /parent_students/);
  assert.match(parent, /role='student'|role = 'student'/);
});