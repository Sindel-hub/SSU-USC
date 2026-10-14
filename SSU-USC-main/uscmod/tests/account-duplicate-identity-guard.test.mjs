import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const provisioning = fs.readFileSync(path.join(root, 'shared/browser-provisioning.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const studentRegistration = fs.readFileSync(path.join(root, 'usc-admin/student-registration/js/student-registration.js'), 'utf8');
const officerRegistration = fs.readFileSync(path.join(root, 'usc-admin/student-registration/js/officer-registration.js'), 'utf8');

test('student and officer provisioning blocks duplicate Student IDs and normalized full names', () => {
  assert.match(provisioning, /student_name_claims/);
  assert.match(provisioning, /normalizeFullName/);
  assert.match(provisioning, /existingMasterlistNameMatch/);
  assert.match(provisioning, /Duplicate Student IDs are not allowed/);
  assert.match(provisioning, /Duplicate account names are not allowed/);

  const duplicateNameChecks = provisioning.match(/existingNameClaim\.exists\(\)/g) || [];
  assert.ok(duplicateNameChecks.length >= 2, 'student and officer account flows should both check the name claim');
});

test('Firestore rules enforce unique name-claim creation for admin provisioning', () => {
  assert.match(rules, /match \/student_name_claims\/\{nameKey\}/);
  assert.match(rules, /!exists\(\/databases\/\$\(database\)\/documents\/student_name_claims\/\$\(nameKey\)\)/);
  assert.match(rules, /request\.resource\.data\.nameKey == nameKey/);
});

test('account creation pages load the duplicate-guard provisioning code version', () => {
  assert.match(studentRegistration, /browser-provisioning\.js\?v=3/);
  assert.match(officerRegistration, /browser-provisioning\.js\?v=3/);
});
