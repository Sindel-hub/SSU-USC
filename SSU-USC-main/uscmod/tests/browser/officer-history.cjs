const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { historyFixture } = require('../helpers/officer-history-fixture.cjs');
const { createManagementHTTPHandler } = require('../../server/http.cjs');
const root = path.resolve(__dirname, '../..');
const output = process.env.USC_REVIEW_OUTPUT || '/tmp/officer-history-browser';
fs.mkdirSync(output, { recursive: true });
const f = historyFixture();
let origin;
const api = createManagementHTTPHandler({ hosted: false, log() {}, getRuntime: () => ({ settings: { allowedOrigins: new Set([origin]), enforceAppCheck: false }, handlers: f.h, verifyIdToken: async token => { const uid = token.replace(/^fixture-/, ''); const p = f.records.get('users/' + uid); if (!p) throw Error(); return { uid, role: p.role, email_verified: true, auth_time: f.now / 1000 }; } }) });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/api/management') return api(req, res);
  const file = path.resolve(root, 'dist', '.' + url.pathname);
  if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  const { buildHosted } = await import('../../scripts/build-hosted.mjs');
  await buildHosted({ env: { USC_ENVIRONMENT: 'staging', USC_FIREBASE_PROJECT_ID: 'ssu-usc-email-staging', USC_FIREBASE_WEB_CONFIG_JSON: JSON.stringify({ apiKey: 'synthetic-public-key', authDomain: 'ssu-usc-email-staging.firebaseapp.com', projectId: 'ssu-usc-email-staging' }), USC_PUBLIC_ORIGIN: 'https://staging.example.invalid' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const errors = [], layouts = [];
  async function pageFor(uid, route) {
    const profile = { ...f.records.get('users/' + uid), uid };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Manila' });
    await context.addInitScript(profile => { globalThis.USC_AUTH_READY = Promise.resolve(true); sessionStorage.setItem('studentProfile', JSON.stringify(profile)); }, profile);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.gstatic.com' && url.pathname.endsWith('firebase-firestore.js')) return route.fulfill({ contentType: 'text/javascript', body: `export const doc=(...a)=>a;export const getDoc=async()=>({data:()=>(${JSON.stringify(profile)})});` });
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('/auth-guard.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (url.pathname === '/firebase/firebase-config.js') return route.fulfill({ contentType: 'text/javascript', body: `export const auth={currentUser:{uid:${JSON.stringify(uid)},getIdToken:async()=>${JSON.stringify('fixture-' + uid)}}};export const db={};export const appCheck=null;export const functions={};` });
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept('Synthetic approved turnover') : dialog.accept());
    await page.goto(origin + route); await page.getByText('Authorized assignments loaded. Select a term to review its tracklist.').waitFor();
    return page;
  }
  async function appointment(page, studentId) {
    await page.locator('#candidateStudentId').fill(studentId); await page.locator('#findOfficerCandidate').click(); await page.locator('#candidateSummary').filter({ hasText: studentId }).waitFor();
    await page.locator('#assignmentPosition').selectOption('Treasurer');
    await page.locator('#administrationPeriod').fill(studentId === '990001' ? '2026–2027' : '2027–2028');
    await page.locator('#appointmentAuthorization').fill('Synthetic approved resolution');
    await page.locator('#termStart').fill('2026-11-20T08:00'); assert.equal(await page.locator('#termEnd').inputValue(), studentId === '990001' ? 'March 2027' : 'March 2028');
    await page.locator('#appointmentConfirmed').check(); await page.getByRole('button', { name: 'Create officer assignment' }).click();
    await page.getByText('Assignment created. Ask the officer to sign out and sign in again.').waitFor();
  }
  try {
    const admin = await pageFor('admin', '/usc-admin/admin-dashboard/officer-management.html');
    await appointment(admin, '990001');
    const treasurer = await pageFor('first', '/usc-admin/officer-tracklist/officer-tracklist.html');
    await treasurer.locator('#financialReportTitle').fill('Synthetic outgoing financial report'); await treasurer.locator('#financialReportContent').fill('Synthetic balances. This report belongs to the outgoing Treasurer.');
    await treasurer.locator('#financialReportConfirmed').check(); await treasurer.getByRole('button', { name: 'Submit report', exact: true }).click();
    await treasurer.getByText('Financial report submitted and preserved under your current assignment.').waitFor();
    await treasurer.getByRole('button', { name: 'View tracklist' }).click(); await treasurer.getByRole('button', { name: 'View preserved record' }).click();
    await treasurer.locator('#recordPreview').waitFor({ state: 'visible' }); await treasurer.screenshot({ path: path.join(output, 'treasurer-report.png'), fullPage: true });
    await admin.getByRole('button', { name: 'Complete term' }).click(); await admin.getByText('Term completed. Historical records are preserved; the outgoing officer must sign in again.').waitFor();
    await appointment(admin, '990002');
    const incoming = await pageFor('second', '/usc-admin/officer-tracklist/officer-tracklist.html');
    await incoming.locator('#assignmentScope').selectOption('office'); await incoming.locator('.history-term').filter({ hasText: 'Synthetic first' }).getByRole('button', { name: 'View tracklist' }).click();
    await incoming.getByRole('button', { name: 'View preserved record' }).click();
    await incoming.locator('#recordContent').filter({ hasText: 'belongs to the outgoing Treasurer' }).waitFor();
    assert.match(await incoming.locator('#recordAttribution').innerText(), /Synthetic first/);
    await incoming.screenshot({ path: path.join(output, 'incoming-treasurer-history.png'), fullPage: true });
    await f.assign('other', 'Public Information Officer');
    const pio = await pageFor('other', '/usc-admin/officer-tracklist/officer-tracklist.html');
    await pio.evaluate(async () => { const { trackedOfficerAction } = await import('/shared/officer-activity-client.js'); await trackedOfficerAction({ module: 'announcements', action: 'publish', input: { title: 'Synthetic officer notice', content: 'Automatically recorded public bulletin.' } }); });
    await pio.getByRole('button', { name: 'View tracklist' }).click(); await pio.getByRole('heading', { name: 'Published', exact: true }).waitFor();
    assert.equal(f.reports().length, 2); assert.equal(f.reports()[1].officerName, 'Synthetic other');
    await pio.screenshot({ path: path.join(output, 'automatic-officer-tracklist.png'), fullPage: true });
    for (const [name, page] of [['admin', admin], ['officer', incoming]]) {
      await page.evaluate(() => scrollTo(0, 0));
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        layouts.push({ name, width, overflow }); assert.equal(overflow, false);
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    const report = { checks: ['Admin Student ID lookup and appointment', 'Treasurer report submission', 'Term completion and student-role restoration', 'Separate incoming assignment', 'Same-office historical reference preserves outgoing attribution', 'Former officer reads own history', 'Actual activity client to hosted API creates automatic bulletin tracklist entry'], layouts, errors, limitations: ['Firebase Auth/Firestore are doubles; live rules and staging are not verified', 'No live records or emails used'] };
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
