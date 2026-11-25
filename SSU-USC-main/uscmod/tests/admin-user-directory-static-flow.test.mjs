import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../usc-admin/admin-dashboard/users.html', import.meta.url), 'utf8');
test('bulk controls and account metadata remain accessible in native disclosures', () => {
  assert.match(html, /<details class="user-directory-bulk-card">/);
  assert.match(html, /<details class="directory-account-details">/);
  for (const id of ['bulkStatusSelect','bulkVerificationSelect','bulkActiveSelect','bulkOfficePositionInput','bulkEffectiveDateInput','bulkReasonInput','applyBulkButton','approveSelectedButton','suspendSelectedButton','clearSelectionButton','selectedUserPermissionSummary','selectedUserComplaintCount','selectedUserVoteStatus']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} is retained exactly once`);
  }
  assert.match(html, /Required when changing status or active access/);
  assert.match(html, /Non-active student standing removes portal access/);
  assert.doesNotMatch(html, /id="bulkRoleSelect"/);
  assert.match(html, /id="targetRoleSelect" disabled/);
  assert.match(html, /This protected admin account cannot be demoted or suspended/);
});
