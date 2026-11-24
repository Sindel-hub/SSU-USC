// Exercise the actual page and hosted handlers using synthetic records.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { historyFixture } = require('../helpers/officer-history-fixture.cjs');
const { createManagementHTTPHandler } = require('../../server/http.cjs');

const root = path.resolve(__dirname, '../..');
const output = process.env.USC_REVIEW_OUTPUT || '/tmp/officer-tracklist-review';
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
let api;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/management') return api(request, response);
  const file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    return response.end();
  }
  response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const fixture = historyFixture();
  await fixture.assign('first', 'Public Information Officer');
  await fixture.assign('second', 'President');
  for (let n = 0; n < 35; n++) {
    fixture.records.set('officer_records/event-' + n, {
      officerUid: 'first', officerName: 'Synthetic first', position: 'Public Information Officer', administration: '2026–2027',
      module: n % 2 ? 'Events' : 'Programs', action: 'Published', status: 'published', recordId: 'event-' + n,
      recordTitle: 'Campus event ' + n, createdAtMs: fixture.now - n
    });
  }
  fixture.records.set('officer_records/case', {
    officerUid: 'second', officerName: 'Synthetic second', administration: '2026–2027', module: 'Complaints', action: 'Resolved',
    status: 'Resolved', recordId: 'case', createdAtMs: fixture.now, snapshot: { title: 'Confidential subject' }
  });
  api = createManagementHTTPHandler({
    hosted: false,
    getRuntime: () => ({
      settings: { allowedOrigins: new Set([base]) },
      handlers: fixture.h,
      verifyIdToken: async token => ({ uid: token, role: 'officer', email_verified: true })
    })
  });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Manila' });
    async function prepare(page, uid, position) {
      await page.addInitScript(({ uid, position }) => {
        globalThis.USC_AUTH_READY = Promise.resolve(true);
        sessionStorage.setItem('studentProfile', JSON.stringify({ uid, role: 'officer', officePosition: position }));
      }, { uid, position });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (/auth-guard\.js|admin-auth\.js|profile-manager\.js|needs-assessment\/needs-assessment\.js/.test(url.pathname)) {
          return route.fulfill({ contentType: 'text/javascript', body: '' });
        }
        if (url.pathname === '/firebase/firebase-config.js') {
          return route.fulfill({ contentType: 'text/javascript', body: 'export const auth={currentUser:{getIdToken:async()=>JSON.parse(sessionStorage.studentProfile).uid}};export const appCheck=null;export const functions={};' });
        }
        return route.continue();
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page, 'first', 'Public Information Officer');
    const tracklist = base + '/usc-admin/officer-tracklist/officer-tracklist.html';
    await page.goto(tracklist);
    const rows = page.locator('.activity-list li');
    await rows.first().waitFor();
    assert.equal(await page.locator('.officer-module-nav a').last().innerText(), 'My O-Tracklists');
    assert.equal(await page.locator('.officer-module-nav a.active').innerText(), 'My O-Tracklists');
    assert.equal(await page.locator('[data-total]').innerText(), '35');
    assert.equal(await page.locator('[data-month]').innerText(), '35');
    assert.equal(await rows.count(), 30);
    assert.equal(await page.locator('select[name=officer]').isVisible(), false);
    await page.getByRole('button', { name: 'Load more' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.activity-list li').length === 35);
    await page.getByLabel('Search', { exact: true }).fill('Campus event 34');
    await page.locator('select[name=module]').selectOption('Events & Programs');
    await page.locator('select[name=year]').selectOption('2026–2027');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await rows.first().getByText('Published · Campus event 34').waitFor();
    assert.equal(await rows.count(), 1);
    const reference = await context.newPage();
    await prepare(reference, 'first', 'Public Information Officer');
    await reference.goto(base + '/usc-admin/needs-assessment/needs-assessment.html');
    const sidebar = page => page.locator('.sidebar').evaluate(node => {
      const style = getComputedStyle(node);
      return { width: node.getBoundingClientRect().width, background: style.backgroundImage, font: style.fontFamily };
    });
    assert.deepEqual(await sidebar(page), await sidebar(reference));
    await reference.close();
    fs.mkdirSync(output, { recursive: true });
    await page.locator('#officerActivityTitle').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'tracklist-desktop.png') });
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('[data-sidebar-toggle]').click();
      assert.equal(await page.locator('[data-sidebar-toggle]').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-sidebar-toggle]').getAttribute('aria-expanded'), 'false');
    }
    await page.screenshot({ path: path.join(output, 'tracklist-mobile.png') });
    const president = await context.newPage();
    await prepare(president, 'second', 'President');
    await president.goto(tracklist);
    await president.locator('.activity-list li').first().waitFor();
    await president.locator('select[name=officer]').selectOption('second');
    await president.getByRole('button', { name: 'Apply filters' }).click();
    await president.getByText('Resolved · case', { exact: true }).waitFor();
    assert.equal(await president.locator('.activity-list li').count(), 1);
    assert.equal(await president.getByText('Confidential subject').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: shared sidebar, summaries, 30+5 pagination, combined filters, mobile widths, officer scope and complaint privacy.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
