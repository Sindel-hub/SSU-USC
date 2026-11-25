import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full)); else out.push(full);
  }
  return out;
}

test('normal runtime has no command-line bridge dependency', () => {
  const files = walk(root);
  assert.equal(files.some((f) => f.toLowerCase().endsWith('.cmd')), false, 'CMD runtime launcher still exists');
  for (const file of files.filter((f) => /\.(js|html|md|json)$/i.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /127\.0\.0\.1:8787|START_FREE_ADMIN_TOOL|free-admin-bridge/i, path.relative(root, file));
  }
});

test('legacy student provisioning remains isolated from admin Auth', () => {
  const source = read('shared/browser-provisioning.js');
  assert.match(source, /initializeApp\(firebaseConfig, appName\)/);
  assert.match(source, /getAuth\(provisioningApp\)/);
  assert.match(source, /createUserWithEmailAndPassword\(provisioningAuth/);
  assert.match(source, /writeBatch\(db\)/);
  assert.match(source, /login_aliases/);
  assert.match(source, /provisionOfficerAccount/);
  assert.match(source, /Separate officer accounts cannot be created/);
  assert.match(source, /sendEmailVerification/);
});

test('admin authority remains custom-claim protected in Firestore rules', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function isAdmin\(\).*role\(\) == "admin"/s);
  assert.doesNotMatch(rules, /request\.auth\.token\.email_verified/);
  assert.match(rules, /Profiles are created by the registration service[\s\S]*?allow create: if false/);
});


test('retired queue redirects without loading its controller', () => {
  const html = read('usc-admin/admin-dashboard/queue.html');
  assert.match(html, /location\.replace\("users\.html"\)/);
  assert.doesNotMatch(html, /admin-queue\.js|queue-workspace/);
});

test('student year level and standing are enforced without capstone-mode UI text', () => {
  const studentHtml = read('usc-admin/student-registration/student-registration.html');
  const studentJs = read('usc-admin/student-registration/js/student-registration.js');
  const authGuard = read('shared/auth-guard.js');
  const loginJs = read('index/js/index.js');
  const rules = read('firestore.rules');
  const usersHtml = read('usc-admin/admin-dashboard/users.html');
  const visibleSources = [studentHtml, studentJs, usersHtml, read('usc-admin/student-registration/officer-registration.html')].join('\n');

  assert.doesNotMatch(visibleSources, /capstone browser mode|capstone-ready|no cmd|powershell/i);
  assert.match(studentHtml, /id="yearLevel"/);
  assert.match(studentHtml, /id="verifyStudent"/);
  assert.match(studentJs, /studentStanding === 'active'/);
  assert.match(studentJs, /studentRegistrationIssue/);
  const provisioning = read('shared/browser-provisioning.js');
  assert.match(provisioning, /isActiveStudentStanding\(studentStanding, enrollmentStatus\)/);
  assert.match(provisioning, /isActive: standingActive/);
  assert.match(authGuard, /isActiveStudentStanding/);
  assert.match(authGuard, /bindProfileAccessWatcher/);
  assert.match(loginJs, /Portal access is disabled because your student standing/);
  assert.match(rules, /request\.resource\.data\.studentStanding in \["active", "leave", "inactive", "graduated", "dropped", "transferred", "withdrawn", "eliminated"\]/);
  assert.match(rules, /request\.resource\.data\.isActive == \(request\.resource\.data\.studentStanding == "active" && request\.resource\.data\.accountStatus != "suspended"\)/);
});
