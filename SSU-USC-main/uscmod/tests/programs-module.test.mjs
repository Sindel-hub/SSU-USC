import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('officer Programs module exists and publishes outside-university programs separately', () => {
  const html = read('usc-admin/programs/programs.html');
  const js = read('usc-admin/programs/js/programs.js');
  assert.match(html, /External Programs & Participation Module/);
  assert.match(html, /Host \/ Partner Organization/);
  assert.match(html, /data-rbac-permission="programs\.manage"/);
  assert.match(js, /collection\(db, "programs"\)/);
  assert.match(js, /secureUpload\(file, "program-media"\)/);
  assert.match(js, /sourceType:\s*"program"/);
});

test('student Events / Programs module merges event and program collections without a second student module', () => {
  const html = read('dashboard/events.html');
  const js = read('dashboard/js/events.js');
  assert.match(html, /Events \/ Programs/);
  assert.match(html, /Upcoming Events &amp; Programs/);
  assert.match(js, /bindSourceFeed\("events", "event"\)/);
  assert.match(js, /bindSourceFeed\("programs", "program"\)/);
  assert.match(js, /EXTERNAL PROGRAM PARTICIPATION/);
  assert.doesNotMatch(html, /href="programs\.html"/);
});

test('Programs have independent RBAC, registrations, and media permissions', () => {
  const permissions = read('shared/officer-permissions.js');
  const rules = read('firestore.rules');
  const security = read('shared/security-client.js');
  assert.match(permissions, /programs\.manage/);
  assert.match(permissions, /\/usc-admin\/programs\//);
  assert.match(rules, /match \/programs\/\{programId\}/);
  assert.match(rules, /officerHasPermission\("programs\.manage"\)/);
  assert.match(rules, /"program-media"/);
  assert.match(security, /"program-media"/);
});
