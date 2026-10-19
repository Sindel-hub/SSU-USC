import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createAdminSetUserPassword, chosenPasswordIsValid } = require('../functions/admin-set-user-password.js');
const index = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../shared/security-client.js', import.meta.url), 'utf8');
const editor = fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/admin-password-editor.js', import.meta.url), 'utf8');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture(options = {}) {
  const writes = [], audits = [], calls = [], profiles = {
    admin: { role: 'admin', accountStatus: 'approved', isActive: true, ...options.admin },
    target: { role: 'student', accountStatus: 'approved', ...options.target }
  };
  const db = { doc(path) { return { path, async get() { const data = profiles[path.split('/')[1]]; return { exists: !!data, data: () => data }; }, async set(data) { if (options.metadataFailure) throw Error('simulated'); writes.push(data); } }; } };
  // Use the production access checks, not a permissive authorization stub.
  const names = ['requireAuth', 'roleOf', 'requireRole', 'requireActiveRole', 'requireRecentAuth', 'requireVerifiedAdminEmail', 'cleanText'];
  const functions = names.map(name => index.match(new RegExp(`(?:async )?function ${name}\\([^]*?(?=\\n(?:async )?function |\\nconst |\\nexports\\.|$)`))[0]).join('\n');
  const context = vm.createContext({ db, HttpsError });
  vm.runInContext(functions, context);
  const dependencies = {
    db, HttpsError, requireActiveRole: context.requireActiveRole, requireRecentAuth: context.requireRecentAuth,
    FieldValue: { serverTimestamp: () => 'timestamp' },
    adminAuth: {
      getUser: async () => ({ customClaims: options.claims || {} }),
      updateUser: async (uid, data) => { if (options.updateFailure) throw options.updateFailure; calls.push({ uid, data }); },
      revokeRefreshTokens: async uid => { if (options.revokeFailure) throw Error('simulated'); calls.push({ revoke: uid }); }
    },
    audit: async (...args) => { if (options.auditFailure) throw Error('simulated'); audits.push(args); }
  };
  const request = { auth: { uid: 'admin', token: { role: 'admin', email_verified: true, auth_time: Math.floor(Date.now()/1000) } }, data: { uid: 'target', password: 'ChosenPass#123' } };
  return { handle: createAdminSetUserPassword(dependencies), request, writes, audits, calls };
}

test('chosen password is sent exactly to Authentication, sessions revoked, and no credential persisted or returned', async () => {
  const f = fixture(); f.request.data.password = ' ChosenPass#123 ';
  const result = await f.handle(f.request);
  assert.deepEqual(f.calls, [{ uid: 'target', data: { password: ' ChosenPass#123 ' } }, { revoke: 'target' }]);
  assert.equal(result.changed, true);
  assert.equal(result.uid, 'target');
  assert.equal(f.writes[0].passwordResetMethod, 'admin-chosen');
  assert.equal(f.audits[0][1], 'USER_PASSWORD_SET');
  assert.doesNotMatch(JSON.stringify([result, f.writes, f.audits]), /ChosenPass/);
});

test('anonymous, officer, untrusted, suspended, unverified, and stale administrator sessions are denied', async () => {
  const cases = [
    f => { f.request.auth = null; },
    f => { f.request.auth.token.role = 'officer'; },
    f => { delete f.request.auth.token.role; },
    f => { f.request.auth.token.email_verified = false; },
    f => { f.request.auth.token.auth_time = 1; }
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    await assert.rejects(f.handle(f.request)); assert.equal(f.calls.length, 0);
  }
  for (const admin of [{ accountStatus: 'suspended' }, { isActive: false }, { role: 'student' }]) {
    const f = fixture({ admin }); await assert.rejects(f.handle(f.request)); assert.equal(f.calls.length, 0);
  }
});

test('self-reset, admin profiles, privileged Auth claims, unknown roles, and missing targets are denied', async () => {
  const self = fixture(); self.request.data.uid = 'admin'; await assert.rejects(self.handle(self.request));
  for (const options of [{ target: { role: 'admin' } }, { target: { role: 'unknown' } }, { claims: { role: 'admin' } }]) {
    const f = fixture(options); await assert.rejects(f.handle(f.request)); assert.equal(f.calls.length, 0);
  }
  const missing = fixture(); missing.request.data.uid = 'missing'; await assert.rejects(missing.handle(missing.request), /profile not found/);
  const invalid = fixture(); invalid.request.data.uid = 'target/another'; await assert.rejects(invalid.handle(invalid.request), /UID/);
});

test('browser and backend enforce the same password policy and reject malformed passwords before writes', async () => {
  const browserPolicy = new Function(editor.replace(/export /g, '') + '; return chosenPasswordIsValid;')();
  for (const password of [null, 123, '', 'short#1A', 'alllowercase#123', 'ALLUPPERCASE#123', 'NoNumbersHere#', 'NoSymbol12345', 'A#1'+'x'.repeat(62), 'ChosenPass#123', ' APassWord#123 ']) {
    assert.equal(browserPolicy(password), chosenPasswordIsValid(password));
    if (!chosenPasswordIsValid(password)) {
      const f = fixture(); f.request.data.password = password;
      await assert.rejects(f.handle(f.request), /10–64/); assert.equal(f.calls.length, 0);
    }
  }
});

test('update failures do not report success or disclose the password', async () => {
  const f = fixture({ updateFailure: { code: 'auth/invalid-password', message: 'ChosenPass#123' } });
  await assert.rejects(f.handle(f.request), error => error.code === 'invalid-argument' && !error.message.includes('ChosenPass'));
  assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
});

test('post-change revocation and audit failures report changed with honest warnings', async () => {
  const f = fixture({ revokeFailure: true, metadataFailure: true, auditFailure: true });
  const result = await f.handle(f.request);
  assert.equal(result.changed, true);
  assert.match(result.warning, /sessions.*metadata.*audit/);
  assert.equal(f.calls.length, 1);
});

test('manual password service errors never fall back to a password-reset email', async () => {
  const code = client.slice(client.indexOf('export async function callSecure('), client.indexOf('\nexport async function loadCurrentElection'))
    .replace('export ', '');
  let emails = 0;
  const context = vm.createContext({ USC_FREE_SPARK_MODE: true,
    callBrowserMode: async () => null,
    callable: () => async () => { throw { code: 'functions/internal', message: 'INTERNAL' }; },
    browserSendAdminPasswordResetEmail: async () => { emails++; return {}; },
    cleanError: () => 'Unconfirmed'
  });
  vm.runInContext(code, context);
  await assert.rejects(context.callSecure('adminSetUserPassword', { uid: 'target', password: 'ChosenPass#123' }), /password service is unavailable/);
  assert.equal(emails, 0);
  assert.match(index, /exports\.adminSetUserPassword = onCall\(callableOptions\(\), createAdminSetUserPassword/);
});
