import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('bulletin board has icon-driven workflow UI', () => {
  const html = read('usc-admin/announcements/announcements.html');
  const css = read('usc-admin/announcements/css/announcements.css');
  assert.match(html, /COMMUNICATION CONTROL CENTER/);
  assert.match(html, /Announcement publishing workflow/);
  assert.match(html, /fa-solid fa-paper-plane/);
  assert.match(html, /module-card-badge/);
  assert.match(css, /announcement-management-page/);
});

test('complaints has icon-driven review workflow UI', () => {
  const html = read('usc-admin/complaints/complaints.html');
  const js = read('usc-admin/complaints/js/complaints.js');
  const css = read('usc-admin/complaints/css/complaints.css');
  assert.match(html, /CASE REVIEW CONTROL CENTER/);
  assert.match(html, /Complaint review workflow/);
  assert.match(html, /fa-solid fa-file-shield/);
  assert.match(js, /complaint-item-icon/);
  assert.match(css, /complaint-management-page/);
});

test('organizational chart uses role-specific icon presentation', () => {
  const html = read('usc-admin/organizational-chart/organizational-chart.html');
  const css = read('usc-admin/organizational-chart/css/organizational-chart.css');
  assert.match(html, /COUNCIL STRUCTURE CENTER/);
  assert.match(html, /Executive Leadership/);
  assert.match(html, /fa-solid fa-crown/);
  assert.match(html, /fa-solid fa-coins/);
  assert.match(css, /org-management-page/);
});

test('officer overview uses consistent icon-driven section actions', () => {
  const html = read('usc-admin/overview/overview.html');
  const css = read('usc-admin/overview/css/overview.css');
  assert.match(html, /overview-module-polish/);
  assert.match(html, /management-suite-icon/);
  assert.match(html, /tracklist-reference-heading/);
  assert.match(html, /fa-solid fa-arrow-up-right-from-square/);
  assert.match(css, /overview-module-polish/);
});
