import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const login = read("index/js/index.js");
const loginHtml = read("index/index.html");
const overviewHtml = read("usc-admin/overview/overview.html");
const overviewJs = read("usc-admin/overview/js/overview.js");
const overviewCss = read("usc-admin/overview/css/overview.css");
const adminCore = read("usc-admin/admin-dashboard/js/admin-core.js");
const backfillScript = read("scripts/backfill-student-signin-analytics.mjs");
const rules = read("firestore.rules");

test("student login records one aggregate sign-in stat per student and upgrades zero-count legacy baselines", () => {
  assert.match(login, /student_signin_stats/);
  assert.match(login, /async function recordStudentSignIn/);
  assert.match(login, /role !== "student"/);
  assert.match(login, /runTransaction/);
  assert.match(login, /const currentCount = Math\.max\(0, Number\(current\.signInCount \|\| 0\)\)/);
  assert.match(login, /signInCount:\s*currentCount \+ 1/);
  assert.match(login, /currentCount === 0 \|\| !current\.firstSignInAt/);
  assert.match(login, /lastSignInAt:\s*serverTimestamp\(\)/);
  assert.match(loginHtml, /js\/index\.js\?v=3/);
});

test("sign-in analytics rules keep student writes scoped, officer reads allowed, and admin legacy backfill constrained", () => {
  const block = rules.match(/match \/student_signin_stats\/\{studentUid\} \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(block, /allow list: if isOfficerOrAdmin\(\)/);
  assert.match(block, /uid\(\) == studentUid/);
  assert.match(block, /request\.resource\.data\.department == ownProfile\(\)\.college/);
  assert.match(block, /request\.resource\.data\.signInCount == resource\.data\.signInCount \+ 1/);
  assert.match(block, /resource\.data\.signInCount == 0/);
  assert.match(block, /isAdmin\(\)/);
  assert.match(block, /legacyBackfill/);
  assert.match(block, /request\.resource\.data\.signInCount in \[0, 1\]/);
});

test("pre-feature student accounts are automatically backfilled from the admin user directory", () => {
  assert.match(adminCore, /async function backfillPreFeatureStudentAnalytics/);
  assert.match(adminCore, /collection\(db, "student_signin_stats"\)/);
  assert.match(adminCore, /signInCount:\s*historicalLoginAt \? 1 : 0/);
  assert.match(adminCore, /legacyBackfill:\s*true/);
  assert.match(adminCore, /void backfillPreFeatureStudentAnalytics\(normalized\)/);
  assert.match(backfillScript, /metadata\?\.lastSignInTime/);
  assert.match(backfillScript, /authLooksLikeRealLaterLogin/);
  assert.match(backfillScript, /2 \* 60 \* 1000/);
});

test("student pie opens a read-only detailed student analytics page", () => {
  const detail=read('usc-admin/overview/student-analytics.html');
  assert.match(overviewHtml, /href="student-analytics.html\?analytics=student"/);
  assert.match(overviewHtml, /data-summary="student"/);
  assert.match(detail, /id="signinAnalyticsDetail" aria-labelledby/);
  assert.match(detail, /Known accounts/);
  assert.match(detail, /Total sign-ins/);
  assert.match(detail, /Accounts & sign-ins by department/);
});

test("student analytics distinguishes pre-feature accounts from actually signed-in students", () => {
  const model=read('usc-admin/overview/js/student-signin-model.mjs');
  assert.match(model, /knownAccounts:\s*records.length/);
  assert.match(model, /const hasSignedIn = signInCount > 0/);
  assert.match(model, /restoredHistorical/);
  assert.match(read('usc-admin/overview/js/student-analytics.js'), /data-signin-known-accounts/);
});
test("student analytics uses a pie and retains the detailed department breakdown", () => {
  const detail=read('usc-admin/overview/student-analytics.html');
  const renderer=read('usc-admin/overview/js/student-analytics.js');
  const charts=read('usc-admin/overview/js/overview-charts.js');
  assert.match(overviewJs, /collection\(db, "student_signin_stats"\)/);
  assert.match(charts,/conic-gradient/);
  assert.match(detail,/signinAnalyticsLargeDonut/);
  assert.match(renderer,/uniqueStudents/);
  assert.match(renderer,/activeToday/);
  assert.match(read('usc-admin/overview/css/overview-unified.css'),/signin-analytics-large-hole \{ display:none/);
});
