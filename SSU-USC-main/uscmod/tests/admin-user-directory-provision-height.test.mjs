import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../usc-admin/admin-dashboard/users.html', import.meta.url), 'utf8');
test('directory links only to Officer Management without account creation', () => {
  assert.match(html, /id="schoolAccountProvisionCard"/);
  assert.doesNotMatch(html, /Register student account|Create officer|student-registration\.html/);
  assert.ok(html.includes('href="officer-management.html"'));
  assert.doesNotMatch(html, /class="card hero-card user-directory-provision-card"/);
});
