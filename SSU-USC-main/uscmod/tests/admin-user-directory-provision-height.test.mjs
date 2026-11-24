import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../usc-admin/admin-dashboard/users.html', import.meta.url), 'utf8');
test('account provisioning remains available without a separate oversized card', () => {
  assert.match(html, /id="schoolAccountProvisionCard"/);
  assert.ok(html.includes('Provision from Student Records'));
  assert.ok(html.includes('href="../student-registration/officer-registration.html"'));
  assert.doesNotMatch(html, /class="card hero-card user-directory-provision-card"/);
});
