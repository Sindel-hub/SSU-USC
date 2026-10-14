import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fn = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const usersHtml = fs.readFileSync(new URL('../usc-admin/admin-dashboard/users.html', import.meta.url), 'utf8');
const usersJs = fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/admin-users.js', import.meta.url), 'utf8');
const loginJs = fs.readFileSync(new URL('../index/js/index.js', import.meta.url), 'utf8');
const studentRegistrationHtml = fs.readFileSync(new URL('../usc-admin/student-registration/student-registration.html', import.meta.url), 'utf8');
const studentRegistrationJs = fs.readFileSync(new URL('../usc-admin/student-registration/js/student-registration.js', import.meta.url), 'utf8');

test('admin password reset is enforced server-side and returns only a newly generated password', () => {
  assert.match(fn, /exports\.adminResetUserPassword\s*=\s*onCall/);
  assert.match(fn, /requireActiveRole\(request, \["admin"\]\)/);
  assert.match(fn, /requireRecentAuth\(request\)/);
  assert.match(fn, /generateTemporaryPassword\(\)/);
  assert.match(fn, /adminAuth\.updateUser\(uid, \{ password: temporaryPassword \}\)/);
  assert.match(fn, /adminAuth\.revokeRefreshTokens\(uid\)/);
  assert.match(fn, /USER_PASSWORD_RESET/);
  assert.doesNotMatch(fn, /password:\s*temporaryPassword[\s\S]{0,400}profileRef\.set\([\s\S]{0,250}temporaryPassword/);
});

test('user directory has reset password control and one-time credential card', () => {
  assert.match(usersHtml, /id="resetUserPasswordButton"/);
  assert.match(usersHtml, /id="passwordResetResultModal"/);
  assert.match(usersHtml, /NEW TEMPORARY PASSWORD/);
  assert.match(usersHtml, /id="copyTemporaryPasswordButton"/);
  assert.match(usersHtml, /id="printTemporaryPasswordButton"/);
  assert.match(usersJs, /callSecure\('adminResetUserPassword'/);
  assert.match(usersJs, /resetSelectedUserPassword/);
});

test('forgot-password login flow points users to administrator-issued temporary passwords', () => {
  assert.match(loginJs, /Contact the System Administrator/);
  assert.match(loginJs, /issue a new temporary password/);
  assert.doesNotMatch(loginJs, /sendPasswordResetEmail/);
});


test('student provisioning page points password recovery to the admin directory reset workflow', () => {
  assert.match(studentRegistrationHtml, /Open User Directory/);
  assert.match(studentRegistrationHtml, /choose <strong>Reset password<\/strong>/);
  assert.doesNotMatch(studentRegistrationJs, /sendStudentPasswordReset/);
});
