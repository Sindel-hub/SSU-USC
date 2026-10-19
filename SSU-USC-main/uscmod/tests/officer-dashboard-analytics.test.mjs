import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/overview/overview.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/overview/js/overview.js", import.meta.url), "utf8");
const studentEvents = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("officer dashboard exposes a unified analytics summary", () => {
  assert.match(html, /General Analytics/);
  for (const key of ['student','event','program','complaint']) assert.match(html, new RegExp(`data-summary="${key}"`));
  assert.doesNotMatch(html, /data-analytics-open="election"/);

});

test("overview loads live registration and complaint analytics without election subscriptions", () => {
  assert.match(js, /collectionGroup\(db, "registrations"\)/);
  assert.match(js, /renderEventParticipationAnalytics/);
  assert.match(js, /renderComplaintAnalytics/);
  assert.doesNotMatch(js, /^bindVoteSummary\(\);/m);
  assert.match(js, /renderOverviewChart/);
});

test("event registrations preserve administrator-controlled student program for analytics", () => {
  assert.match(studentEvents, /program: clean\(studentProfile\?\.program\)/);
  assert.match(rules, /"college", "program", "yearLevel", "status", "registeredAt"/);
  assert.match(rules, /request\.resource\.data\.program == ownProfile\(\)\.program/);
});

test("all authenticated officers can read event registrations for dashboard analytics", () => {
  assert.match(rules, /allow read: if \(schoolStudent\(\) && ownUser\(userId\)\) \|\| isOfficerOrAdmin\(\);/);
});
