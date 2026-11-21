// Real browser transport + hosted HTTP handler + service logic, with isolated
// Auth/Firestore and SMTP doubles. No Firebase project or mailbox is contacted.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { hostedFixture } = require('../helpers/hosted-runtime-fixture.cjs');
const { createManagementHTTPHandler } = require('../../server/http.cjs');
const root = path.resolve(__dirname, '../..');
const out = process.env.USC_REVIEW_OUTPUT || '/tmp/usc-hosted-review';
fs.mkdirSync(out, { recursive: true });
let f, api;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/management') return api(req, res);
  const file = path.join(root, 'dist', url.pathname);
  if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const ext = path.extname(file);
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  const { buildHosted } = await import('../../scripts/build-hosted.mjs');
  await buildHosted({ env: { USC_ENVIRONMENT: 'staging', USC_FIREBASE_PROJECT_ID: 'ssu-usc-email-staging', USC_FIREBASE_WEB_CONFIG_JSON: JSON.stringify({ apiKey: 'synthetic-public-key', authDomain: 'ssu-usc-email-staging.firebaseapp.com', projectId: 'ssu-usc-email-staging' }), USC_PUBLIC_ORIGIN: 'https://staging.example.invalid' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  f = hostedFixture(base);
  api = createManagementHTTPHandler({ getRuntime: () => f.runtime, hosted: false, log: entry => f.logs.push(entry) });
  const existing = { uid: 'continuing-fixture', studentId: '990000001', fullName: 'Synthetic Continuing Student', role: 'student', accountStatus: 'approved', isActive: true, studentStanding: 'active', institutionalEmail: 'continuing@example.invalid', email: 'continuing@example.invalid', college: 'College of Engineering', program: 'Bachelor of Science in Civil Engineering', yearLevel: '1st Year', academicYear: '2025-2026' };
  f.seed(existing, { password: 'Existing-synthetic-password' });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Manila' });
    const errors = [], apiCalls = [];
    await context.addInitScript(() => { globalThis.USC_AUTH_READY = Promise.resolve(true); sessionStorage.setItem('studentProfile', JSON.stringify({ role: 'admin', fullName: 'Synthetic Administrator' })); });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (/auth-guard\.js|admin-only-auth\.js|profile-manager\.js/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (url.pathname === '/firebase/firebase-config.js') return route.fulfill({ contentType: 'text/javascript', body: 'export const auth={currentUser:{getIdToken:async()=>"fixture-admin"}};export const appCheck=null;export const functions={};' });
      if (url.pathname === '/api/management') apiCalls.push(JSON.parse(route.request().postData()));
      return route.continue();
    });
    const admin = await context.newPage();
    admin.on('pageerror', error => errors.push(error.message));
    admin.on('dialog', dialog => dialog.accept());
    await admin.goto(base + '/usc-admin/admin-dashboard/student-records.html');
    await admin.locator('[data-student="990000001"]').waitFor();
    const csv = 'studentId,fullName,department,program,yearLevel,email,status\n990000001,Synthetic Continuing Student,College of Engineering,Bachelor of Science in Civil Engineering,2,continuing@example.invalid,active\n990000002,Synthetic New Student,College of Engineering,Bachelor of Science in Civil Engineering,1,new@example.invalid,active';
    await admin.locator('#importYear').fill('2026-2027');
    await admin.locator('#studentImportFile').setInputFiles({ name: 'synthetic-students.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await admin.locator('#importAuthorized').check();
    await admin.getByRole('button', { name: 'Validate and preview' }).click();
    await admin.getByText('Preview ready. Review every proposed change before applying.').waitFor();
    await admin.locator('#importPreview').scrollIntoViewIfNeeded();
    await admin.screenshot({ path: path.join(out, 'hosted-import-preview.png'), fullPage: true });
    await admin.locator('#confirmImport').check();
    await admin.locator('#applyStudentImport').click();
    await admin.getByText('Import completed. Check activation email status for new accounts.').waitFor();
    assert.equal(f.mail.length, 1);
    assert.equal(f.mail[0].from.address, 'usc.synthetic.notifications@gmail.com');
    assert.equal(f.authUsers.get(existing.uid).password, 'Existing-synthetic-password');
    assert.equal(f.records.get('users/' + existing.uid).yearLevel, '2nd Year');
    const link = f.mail[0].text.match(/http:\/\/127\.0\.0\.1:\d+\/activate\/index\.html#token=[a-f0-9]{64}/)[0];
    const student = await context.newPage();
    student.on('pageerror', error => errors.push(error.message));
    await student.goto(link);
    await student.locator('#activationPassword').fill('Synthetic-student-password');
    await student.locator('#activationConfirm').fill('Synthetic-student-password');
    await student.locator('#activationSubmit').click();
    await student.getByText('Your email is verified and your account is activated. You can now sign in.').waitFor();
    assert.equal(new URL(student.url()).hash, '');
    await student.screenshot({ path: path.join(out, 'hosted-activation-confirmation.png'), fullPage: true });
    await student.goto(link);
    await student.reload();
    await student.locator('#activationPassword').fill('Do-not-change-the-password');
    await student.locator('#activationConfirm').fill('Do-not-change-the-password');
    await student.locator('#activationSubmit').click();
    await student.getByText('Activation link is invalid, expired, or already used. Ask the administrator for a new link.').waitFor();
    async function call(action, data) { const result = await fetch(base + '/api/management', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-admin', Origin: base }, body: JSON.stringify({ action, data }) }); const payload = await result.json(); assert.equal(result.status, 200, JSON.stringify(payload)); return payload.data; }
    const survey = await call('needsAssessmentManage', { action: 'save', input: { title: 'Student priorities', description: 'Tell USC what matters to your department.', opensAt: f.now - 1000, closesAt: f.now + 86400000, departments: ['College of Engineering'], questions: [{ label: 'Which support should USC prioritize?', type: 'single', options: ['Study spaces', 'Wellbeing support'] }] } });
    await call('needsAssessmentManage', { action: 'publish', surveyId: survey.id });
    await student.goto(base + '/survey/index.html?id=' + survey.id);
    await student.locator('#surveyDepartment').selectOption('College of Engineering');
    await student.getByLabel('Study spaces', { exact: true }).check();
    await student.locator('#surveySubmit').click();
    await student.locator('#surveyConfirmation').waitFor({ state: 'visible' });
    await student.screenshot({ path: path.join(out, 'hosted-survey-confirmation.png'), fullPage: true });
    assert.equal(f.records.get('needs_assessment_surveys/' + survey.id).responseCount, 1);
    const layouts = [];
    for (const width of [1440, 390]) {
      await admin.setViewportSize({ width, height: 1000 });await student.setViewportSize({ width, height: 900 });
      for (const [name, page] of [['admin', admin], ['public', student]]) layouts.push({ name, width, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
      if (width === 390) { await admin.evaluate(() => window.scrollTo(0, 0));await admin.screenshot({ path: path.join(out, 'hosted-admin-mobile.png'), fullPage: true });await student.screenshot({ path: path.join(out, 'hosted-survey-mobile.png'), fullPage: true }); }
    }
    assert.ok(layouts.every(result => !result.overflow));assert.deepEqual(errors, []);
    assert.ok(apiCalls.some(call => call.action === 'studentAnnualApply'));
    assert.ok(apiCalls.some(call => call.action === 'studentActivateAccount'));
    assert.ok(apiCalls.some(call => call.action === 'needsAssessmentSubmit'));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ layouts, errors, requestActions: [...new Set(apiCalls.map(call => call.action))], smtpFixtureMessages: f.mail.length, checks: ['actual hosted client and HTTP route', 'admin import preview/apply', 'existing account preserved', 'SMTP adapter message generated', 'public activation', 'used link rejected', 'anonymous survey submission'], limitations: ['Auth, Firestore and SMTP are isolated doubles', 'No actual Gmail message or live project access'] }, null, 2));
    console.log('Hosted browser checks passed:', layouts);
    await context.close();
  } finally { await browser.close();server.close(); }
})().catch(error => { console.error(error);server.close();process.exitCode = 1; });
