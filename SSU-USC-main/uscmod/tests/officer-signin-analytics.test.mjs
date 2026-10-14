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

test("officer dashboard exposes inline department analytics without navigating modules", () => {
  assert.match(overviewHtml, /id="studentSignInAnalytics"/);
  assert.match(overviewHtml, /id="signinAnalyticsSummary"/);
  assert.match(overviewHtml, /id="signinAnalyticsDetail" hidden/);
  assert.doesNotMatch(overviewHtml, /id="signinAnalyticsSummary"[^>]*href=/);
  assert.match(overviewHtml, /Student sign-ins by college \/ department/);
  assert.match(overviewHtml, /Known accounts/);
  assert.match(overviewHtml, /Unique students/);
  assert.match(overviewHtml, /Total sign-ins/);
  assert.match(overviewHtml, /Accounts & sign-ins by department/);
});

test("officer analytics distinguishes pre-feature accounts from actually signed-in students", () => {
  assert.match(overviewJs, /knownAccounts:\s*state\.signInStats\.length/);
  assert.match(overviewJs, /const hasSignedIn = signInCount > 0/);
  assert.match(overviewJs, /accountCount/);
  assert.match(overviewJs, /restoredHistorical/);
  assert.match(overviewJs, /data-signin-known-accounts/);
  assert.match(overviewJs, /No tracked sign-in yet/);
});

test("officer analytics renders a donut and detailed department breakdown", () => {
  assert.match(overviewJs, /collection\(db, "student_signin_stats"\)/);
  assert.match(overviewJs, /conic-gradient/);
  assert.match(overviewJs, /uniqueStudents/);
  assert.match(overviewJs, /activeToday/);
  assert.match(overviewJs, /setSignInAnalyticsExpanded/);
  assert.match(overviewCss, /\.signin-analytics-mini-chart/);
  assert.match(overviewCss, /\.signin-analytics-large-donut/);
  assert.match(overviewCss, /\.signin-analytics-detail-grid/);
  assert.match(overviewCss, /repeat\(5,minmax\(0,1fr\)\)/);
});
