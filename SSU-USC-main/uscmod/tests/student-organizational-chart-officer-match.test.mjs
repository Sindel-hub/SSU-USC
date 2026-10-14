import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const html = fs.readFileSync(path.join(root, 'dashboard/organizational-chart.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard/css/organizational-chart.css'), 'utf8');

test('student organizational chart mirrors the officer role structure', () => {
  for (const role of [
    'President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor', 'P.R.O.',
    'Business Manager', 'Sergeant-at-Arms', 'Department Representatives'
  ]) assert.match(html, new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('student organizational chart uses officer-inspired visual sections', () => {
  assert.match(html, /COUNCIL STRUCTURE CENTER/);
  assert.match(html, /Executive Leadership/);
  assert.match(html, /Core Operations/);
  assert.match(html, /Representation/);
  assert.match(css, /student-officer-org-card/);
  assert.match(css, /linear-gradient/);
});
