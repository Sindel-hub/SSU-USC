import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { buildHosted } from '../scripts/build-hosted.mjs';
const require = createRequire(import.meta.url);
const { readPublicSettings, readServerSettings, readGmailSettings, ServiceError } = require('../server/settings.cjs');
const { createAuthorization } = require('../server/authorization.cjs');
const { createActivationMailer } = require('../server/activation-mail.cjs');
const { createManagementHTTPHandler, ACTIONS, clientIP } = require('../server/http.cjs');
const { createPublicLimiter } = require('../server/runtime.cjs');
const { hostedFixture } = require('./helpers/hosted-runtime-fixture.cjs');
const { DEPARTMENTS } = require('../functions/student-records-model.js');
function environment(patch = {}) {
  return {
    USC_ENVIRONMENT: 'staging', USC_FIREBASE_PROJECT_ID: 'ssu-usc-email-staging', USC_PUBLIC_ORIGIN: 'https://staging.example.invalid',
    USC_FIREBASE_WEB_CONFIG_JSON: JSON.stringify({ apiKey: 'synthetic-public-key', authDomain: 'ssu-usc-email-staging.firebaseapp.com', projectId: 'ssu-usc-email-staging' }),
    USC_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', project_id: 'ssu-usc-email-staging', client_email: 'synthetic@ssu-usc-email-staging.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-NOT-A-CREDENTIAL\n-----END PRIVATE KEY-----' }),
    ...patch
  };
}
async function request(f, action, data = {}, options = {}) {
  const headers = { 'content-type': 'application/json', origin: 'https://staging.example.invalid', authorization: 'Bearer fixture-admin', ...options.headers };
  const req = { method: options.method || 'POST', headers, body: options.body ?? { action, data }, socket: { remoteAddress: '127.0.0.1' } };
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
  await createManagementHTTPHandler({ getRuntime: () => f.runtime, hosted: false, log: entry => f.logs.push(entry) })(req, response);
  return response;
}
const student = () => ({ studentId: '990000001', fullName: 'Synthetic Student', department: DEPARTMENTS[3], program: 'Bachelor of Science in Civil Engineering', yearLevel: '1', email: 'student@example.invalid', status: 'active' });
test('hosted settings require matching public/private project identities and isolated previews', () => {
  assert.equal(readServerSettings(environment()).projectId, 'ssu-usc-email-staging');
  for (const patch of [
    { USC_ENVIRONMENT: '' }, { USC_FIREBASE_PROJECT_ID: 'universitystudentcouncil-856cc' },
    { USC_FIREBASE_SERVICE_ACCOUNT_JSON: '{}' },
    { USC_FIREBASE_WEB_CONFIG_JSON: JSON.stringify({ projectId: 'ssu-usc-email-staging', private_key: 'DO-NOT-PUBLISH' }) },
    { USC_PUBLIC_ORIGIN: 'https://ssu-usc.vercel.app' }, { USC_PUBLIC_ORIGIN: 'http://127.0.0.1:5500' },
    { VERCEL_ENV: 'production' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, { USC_ENFORCE_APP_CHECK: 'true' }
  ]) assert.throws(() => readServerSettings(environment(patch)));
});
test('preview links derive from the trusted deployment environment, never request headers', () => {
  const env = environment({ USC_PUBLIC_ORIGIN: '', VERCEL_ENV: 'preview', VERCEL_URL: 'synthetic-preview.vercel.app' });
  assert.equal(readPublicSettings(env).publicOrigin, 'https://synthetic-preview.vercel.app');
  assert.throws(() => readPublicSettings(environment({ USC_PUBLIC_ORIGIN: 'https://user:password@example.invalid' })));
  assert.throws(() => readPublicSettings(environment({ USC_PUBLIC_ORIGIN: 'https://example.invalid/extra' })));
});
test('Gmail app-password settings accept grouped passwords and require a dedicated Gmail sender', () => {
  assert.equal(readGmailSettings({ USC_GMAIL_USER: 'usc.notifications@gmail.com', USC_GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' }).pass, 'abcdefghijklmnop');
  assert.throws(() => readGmailSettings({ USC_GMAIL_USER: 'someone@example.invalid', USC_GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }));
  assert.throws(() => readGmailSettings({ USC_GMAIL_USER: 'usc.notifications@gmail.com', USC_GMAIL_APP_PASSWORD: 'ordinary-password' }));
});
test('SMTP adapter uses TLS, authenticates the sender and checks recipient acceptance', async () => {
  let options, message;
  const send = createActivationMailer({ publicOrigin: 'https://staging.example.invalid', env: { USC_GMAIL_USER: 'usc.notifications@gmail.com', USC_GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }, createTransport: config => { options = config; return { sendMail: async data => { message = data; return { accepted: [data.to], rejected: [] }; } }; } });
  await send({ email: 'student@example.invalid', studentId: '990000001', token: 'a'.repeat(64), messageId: 'b'.repeat(64) });
  assert.equal(options.host, 'smtp.gmail.com'); assert.equal(options.port, 465); assert.equal(options.secure, true);
  assert.equal(message.from.address, options.auth.user); assert.ok(message.text.includes('https://staging.example.invalid/activate/index.html#token='));
  assert.equal(message.text.includes(options.auth.pass), false); assert.equal(options.logger, false); assert.equal(options.disableUrlAccess, true);
  const rejected = createActivationMailer({ publicOrigin: 'https://staging.example.invalid', env: { USC_GMAIL_USER: 'usc.notifications@gmail.com', USC_GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }, createTransport: () => ({ sendMail: async () => ({ accepted: [], rejected: ['student@example.invalid'] }) }) });
  await assert.rejects(rejected({ email: 'student@example.invalid', studentId: '1', token: 'a', messageId: 'b' }), { code: 'unavailable' });
});
test('HTTP router rejects methods, wrong content types, forged envelopes and unknown actions', async () => {
  const f = hostedFixture();
  assert.equal((await request(f, 'studentRecordsList', {}, { method: 'GET' })).statusCode, 405);
  assert.equal((await request(f, 'studentRecordsList', {}, { headers: { 'content-type': 'text/plain' } })).statusCode, 400);
  assert.equal((await request(f, '', {}, { body: '{not-json' })).statusCode, 400);
  assert.equal((await request(f, 'removeAccount')).statusCode, 400);
  assert.equal((await request(f, '', {}, { body: { action: 'studentRecordsList', data: {}, auth: { uid: 'admin' } } })).statusCode, 400);
  assert.equal((await request(f, '', {}, { body: { action: 'studentRecordsList', data: { text: 'x'.repeat(1024 * 1024) } } })).statusCode, 400);
  assert.equal(f.verifiedTokens.length, 0); assert.equal(ACTIONS.size, 21);
  for (const action of ["officerCandidateFind", "officerAssignmentManage", "officerAssignments", "officerTracklist", "officerRecord", "officerReportSubmit", "officerModuleAction"]) assert.ok(ACTIONS.has(action));
});
test('authenticated API calls reject missing, revoked and unauthorized student/officer tokens', async () => {
  const f = hostedFixture();
  for (const authorization of ['', 'Bearer revoked-token', 'Bearer fixture-student', 'Bearer fixture-officer']) {
    const result = await request(f, 'studentRecordsList', {}, { headers: { authorization } });
    assert.ok([401, 403].includes(result.statusCode));
  }
  const result = await request(f, 'studentRecordsList');
  assert.equal(result.statusCode, 200); assert.deepEqual(result.body.data.students, []);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('API validates browser origin and App Check without granting CORS access', async () => {
  const f = hostedFixture();
  assert.equal((await request(f, 'studentRecordsList', {}, { headers: { origin: 'https://evil.example.invalid' } })).statusCode, 403);
  f.runtime.settings.enforceAppCheck = true;
  assert.equal((await request(f, 'studentRecordsList')).statusCode, 401);
  assert.equal((await request(f, 'studentRecordsList', {}, { headers: { 'x-firebase-appcheck': 'bad' } })).statusCode, 401);
  const result = await request(f, 'studentRecordsList', {}, { headers: { 'x-firebase-appcheck': 'valid-app-check' } });
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
});
test('private profile and recent-auth checks are applied server-side, including revoked roles', async () => {
  const f = hostedFixture(), auth = createAuthorization({ db: f.db, clock: () => f.now });
  const request = { auth: { uid: 'admin-test', token: { role: 'admin', email_verified: true } } };
  assert.throws(() => auth.requireRecentAuth(request), { code: 'failed-precondition' });
  f.records.get('users/admin-test').isActive = false;
  await assert.rejects(auth.requireActiveRole(request, ['admin']), { code: 'permission-denied' });
  f.records.get('users/admin-test').isActive = true;
  await assert.rejects(auth.requireActiveRole({ auth: { uid: 'admin-test', token: { role: 'admin', email_verified: false } } }, ['admin']), { code: 'failed-precondition' });
});
test('survey management checks real position/custom permissions instead of accepting browser claims', async () => {
  const f = hostedFixture();
  f.records.set('users/officer-test', { role: 'officer', accountStatus: 'approved', isActive: true, studentStanding: 'active', officePosition: 'Treasurer', officerPermissionSource: 'custom', officerPermissions: ['dashboard.view'] });
  const auth = createAuthorization({ db: f.db, clock: () => f.now });
  await assert.rejects(auth.requireOfficerPermission({ auth: { uid: 'officer-test', token: { role: 'officer' } } }, 'bulletin.manage'), { code: 'permission-denied' });
  f.records.get('users/officer-test').officerPermissions.push('bulletin.manage');
  await auth.requireOfficerPermission({ auth: { uid: 'officer-test', token: { role: 'officer' } } }, 'bulletin.manage');
});
test('hosted HTTP integration provisions, sends through the SMTP adapter, activates and rejects reused links', async () => {
  const f = hostedFixture();
  const p = await request(f, 'studentAnnualPreview', { rows: [student()], academicYear: '2026-2027', authorized: true });
  assert.equal(p.statusCode, 200); assert.equal(p.body.data.hasErrors, false);
  const a = await request(f, 'studentAnnualApply', { importId: p.body.data.importId, start: 0 });
  assert.equal(a.statusCode, 200); assert.equal(a.body.data.results[0].emailStatus, 'sent'); assert.equal(f.mail.length, 1);
  const token = f.mail[0].text.match(/#token=([a-f0-9]{64})/)[1];
  const activated = await request(f, 'studentActivateAccount', { token, password: 'Synthetic-student-password' }, { headers: { authorization: '' } });
  assert.equal(activated.statusCode, 200); assert.equal(activated.body.data.canAccess, true);
  const uid = a.body.data.results[0].uid; assert.equal(f.records.get('users/' + uid).isActive, true);
  const reused = await request(f, 'studentActivateAccount', { token, password: 'Do-not-reset-this-password' }, { headers: { authorization: '' } });
  assert.equal(reused.statusCode, 412); assert.equal(f.authUsers.get(uid).password, 'Synthetic-student-password');
  assert.equal(JSON.stringify(a.body).includes(token), false);
});
test('anonymous survey HTTP calls expose no author/response data and enforce public throttling', async () => {
  const f = hostedFixture(), q = { title: 'Synthetic priorities', description: '', departments: [DEPARTMENTS[3]], opensAt: f.now - 1000, closesAt: f.now + 60000, questions: [{ label: 'Priority?', type: 'single', options: ['Study', 'Wellbeing'] }] };
  const created = await request(f, 'needsAssessmentManage', { action: 'save', input: q });
  const id = created.body.data.id; await request(f, 'needsAssessmentManage', { action: 'publish', surveyId: id });
  const result = await request(f, 'needsAssessmentPublic', { surveyId: id }, { headers: { authorization: '' } });
  assert.equal(result.statusCode, 200); assert.equal(result.body.data.createdBy, undefined); assert.equal(result.body.data.responseCount, undefined);
  const submitted = await request(f, 'needsAssessmentSubmit', { surveyId: id, submissionId: '11111111-1111-1111-1111-111111111111', department: DEPARTMENTS[3], answers: { q1: 'Study' } }, { headers: { authorization: '' } });
  assert.equal(submitted.statusCode, 200); assert.equal(f.records.get('needs_assessment_surveys/' + id).responseCount, 1);
  for (let n = 0; n < 120; n++) await request(f, 'needsAssessmentPublic', { surveyId: id }, { headers: { authorization: '' } });
  assert.equal((await request(f, 'needsAssessmentPublic', { surveyId: id }, { headers: { authorization: '' } })).statusCode, 429);
});
test('public rate limit uses a keyed opaque network identifier and resets the window', async () => {
  const f = hostedFixture(), limit = createPublicLimiter({ db: f.db, key: 'synthetic-secret', clock: () => f.now });
  const id = await limit('studentActivateAccount', '192.0.2.1');assert.equal(id.length, 64);
  assert.equal(JSON.stringify([...f.records]).includes('192.0.2.1'), false);
  for (let n = 1; n < 30; n++) await limit('studentActivateAccount', '192.0.2.1');
  await assert.rejects(limit('studentActivateAccount', '192.0.2.1'), { code: 'resource-exhausted' });
  f.advance(60000); await limit('studentActivateAccount', '192.0.2.1');
  assert.equal(clientIP({ headers: { 'x-forwarded-for': '192.0.2.2' }, socket: { remoteAddress: '127.0.0.1' } }, false), '127.0.0.1');
});
test('configuration and unexpected errors never disclose private details in responses or logs', async () => {
  const f = hostedFixture();
  f.runtime.handlers.studentRecordsList = () => { throw Error('PRIVATE-KEY-PASSWORD-TOKEN'); };
  const result = await request(f, 'studentRecordsList');assert.equal(result.statusCode, 500);
  assert.equal(JSON.stringify([result, f.logs]).includes('PRIVATE-KEY-PASSWORD-TOKEN'), false);
  const response = { setHeader() {}, end(body) { this.body = body; } };
  await createManagementHTTPHandler({ getRuntime: () => { throw Error('SECRET'); }, log() {} })({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'studentRecordsList', data: {} } }, response);
  assert.equal(response.statusCode, 503);assert.equal(response.body.includes('SECRET'), false);
});
test('browser transport sends protected requests to the same-origin API with access cookies and omits Firebase auth for anonymous actions', async () => {
  const source = (await fs.readFile(new URL('../shared/hosted-management-client.js', import.meta.url), 'utf8')).replace(/^import .*\n/, '').replace('export async function', 'async function');
  const calls = [], context = vm.createContext({ auth: { currentUser: { getIdToken: async () => 'synthetic-token' } }, appCheck: null, functions: {}, AbortSignal, fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ data: { ok: true } }) }; } });
  vm.runInContext(source + '\nglobalThis.testCall = hostedManagementCall;', context);
  await context.testCall('studentRecordsList', {});await context.testCall('studentActivateAccount', { token: 'synthetic' });
  assert.equal(calls[0].url, '/api/management');assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-token');assert.equal(calls[0].options.credentials, 'same-origin');assert.equal(calls[1].options.headers.Authorization, undefined);assert.equal(calls[1].options.credentials, 'same-origin');
  context.auth.currentUser = null;await assert.rejects(context.testCall('studentRecordsList', {}), /sign in/i);
});
test('public build excludes backend, exports, secrets and backups and injects only matching web config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usc-hosted-build-'));
  try {
    for (const folder of ['firebase', 'shared', 'supabase', 'supabase/functions', 'home', 'functions', 'server', '.emulator-data.local']) await fs.mkdir(path.join(root, folder), { recursive: true });
    await fs.writeFile(path.join(root, 'firebase/firebase-config.js'), 'export const firebaseConfig = {\n  projectId: "production-original"\n};\n');
    await fs.writeFile(path.join(root, 'shared/app-config.js'), 'globalThis.USC_APP_CHECK_SITE_KEY = "YOUR_KEY";');
    await fs.writeFile(path.join(root, 'supabase/supabase-config.js'), 'production-supabase');
    await fs.writeFile(path.join(root, 'home/home.html'), '<h1>Existing public page</h1>');
    for (const file of ['functions/.secret.local', 'server/private.cjs', '.emulator-data.local/records.json', 'firebase/firebase-config.original.local-backup', 'shared/service-account.json', 'supabase/functions/private.ts']) await fs.writeFile(path.join(root, file), 'PRIVATE-MARKER');
    const output = path.join(root, 'dist');await buildHosted({ root, output, env: environment() });
    assert.ok((await fs.readFile(path.join(output, 'firebase/firebase-config.js'), 'utf8')).includes('ssu-usc-email-staging'));
    assert.ok((await fs.readFile(path.join(output, 'supabase/supabase-config.js'), 'utf8')).includes('disabled'));
    assert.ok((await fs.readFile(path.join(output, 'shared/app-config.js'), 'utf8')).includes('Production Supabase is blocked'));
    for (const file of ['functions/.secret.local', 'server/private.cjs', '.emulator-data.local/records.json', 'firebase/firebase-config.original.local-backup', 'shared/service-account.json', 'supabase/functions/private.ts']) await assert.rejects(fs.access(path.join(output, file)));
    await assert.rejects(buildHosted({ root, output: root, env: environment() }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('startup diagnostics classify failures without logging private exception data', async () => {
  const cases = [
    [new ServiceError('failed-precondition', 'Firebase service account must be configured as a JSON object.'), 'service-account-json-invalid'],
    [Object.assign(new Error('PRIVATE-KEY-PASSWORD-TOKEN'), {code:'app/invalid-credential'}), 'firebase-credential-invalid'],
    [Object.assign(new Error('PRIVATE-KEY-PASSWORD-TOKEN'), {code:'PRIVATE-KEY-PASSWORD-TOKEN',startupStep:'PRIVATE-KEY-PASSWORD-TOKEN',name:'PRIVATE-KEY-PASSWORD-TOKEN'}), 'runtime-startup-failed']
  ];
  for (const [error, category] of cases) {
    const logs = [], response = {setHeader() {}, end(body) {this.body = body;}};
    await createManagementHTTPHandler({getRuntime: () => {throw error;}, log: entry => logs.push(entry)})({method:'POST', headers:{'content-type':'application/json'}, body:{action:'studentRecordsList',data:{}}}, response);
    assert.equal(response.statusCode,503);
    assert.equal(logs[0].category,category);
    assert.equal(logs[0].stage,'runtime-startup');
    assert.equal(JSON.stringify([logs,response.body]).includes('PRIVATE-KEY-PASSWORD-TOKEN'),false);
    assert.equal(response.body.includes(category),false);
  }
});
