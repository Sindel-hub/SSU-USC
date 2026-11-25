import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../usc-admin/admin-dashboard/users.html', import.meta.url), 'utf8');
test('directory retains student registration and routes officer promotion to Officer Management', () => {
  assert.match(html, /id="schoolAccountProvisionCard"/);
  assert.match(html, /href="\.\.\/student-registration\/student-registration\.html"[^>]*>[\s\S]*?Register student account<\/a>/);
  assert.doesNotMatch(html, /Create officer|officer-registration\.html/);
  assert.ok(html.includes('href="officer-management.html"'));
  assert.doesNotMatch(html, /class="card hero-card user-directory-provision-card"/);
});
