import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const security = fs.readFileSync(new URL('../shared/security-client.js', import.meta.url), 'utf8');
const usersJs = fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/admin-users.js', import.meta.url), 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));

test('browser-only runtime falls back to Firebase reset email instead of configuration error', () => {
  assert.match(security, /sendPasswordResetEmail/);
  assert.match(security, /browserSendAdminPasswordResetEmail/);
  assert.match(security, /name === "adminResetUserPassword" && globalThis\.USC_FREE_SPARK_MODE === true/);
  assert.match(security, /emailResetSent:\s*true/);
});

test('user directory reports email fallback as a successful recovery action', () => {
  assert.match(usersJs, /result\?\.emailResetSent === true/);
  assert.match(usersJs, /Password recovery link sent to/);
  assert.match(usersJs, /choose a new password/);
});

test('firebase config declares functions source for optional privileged temporary-password reset', () => {
  assert.equal(firebaseJson.functions?.source, 'functions');
});
