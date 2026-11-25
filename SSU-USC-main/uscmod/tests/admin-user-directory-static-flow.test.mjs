import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../usc-admin/admin-dashboard/users.html', import.meta.url), 'utf8');
test('individual account metadata remains accessible while retired controls are absent', () => {
  assert.doesNotMatch(html, /user-directory-bulk-card|exportFilteredButton|exportSelectedButton|toggleAllUsers|candidacyToggle|selectedUserVoteStatus/);
  assert.match(html, /<details class="directory-account-details">/);
  for (const id of ['selectedUserPermissionSummary','selectedUserComplaintCount','verifiedToggle','approveUserButton','suspendUserButton','removeUserButton','reactivateUserButton','resetUserPasswordButton']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} is retained exactly once`);
  }
  assert.match(html, /Required when changing status or active access/);
  assert.match(html, /Non-active student standing removes portal access/);
  assert.doesNotMatch(html, /id="bulkRoleSelect"/);
  assert.match(html, /id="targetRoleSelect" disabled/);
  assert.match(html, /This protected admin account cannot be demoted or suspended/);
});
