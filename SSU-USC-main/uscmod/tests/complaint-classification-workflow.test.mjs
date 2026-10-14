import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const studentHtml = read("complaint/complaint.html");
const officerHtml = read("usc-admin/complaints/complaints.html");
const officerJs = read("usc-admin/complaints/js/complaints.js");
const securityJs = read("shared/security-client.js");
const tracklistHtml = read("dashboard/tracklist.html");
const tracklistJs = read("dashboard/js/tracklist.js");
const notificationsJs = read("dashboard/js/notifications.js");
const rules = read("firestore.rules");

test("complaint classification is assigned by USC after student submission", () => {
  assert.match(studentHtml, /What happens next/);
  assert.match(studentHtml, /Student Level/);
  assert.match(studentHtml, /Administrative Level/);
  assert.match(studentHtml, /Crisis Level/);
  assert.doesNotMatch(studentHtml, /id="detailClassification"/, "students must not assign the review classification");
  assert.match(officerHtml, /id="detailClassification"/);
  assert.match(officerHtml, /Pending Classification/);
});

test("officer workflow saves classification and sends one-way USC feedback", () => {
  assert.match(officerHtml, /USC Feedback/);
  assert.match(officerHtml, /Send Feedback/);
  assert.match(officerJs, /classification:\s*nextClassification/);
  assert.match(officerJs, /feedback:\s*feedbackText/);
  assert.match(officerJs, /nextStatus === "Submitted"/);
  assert.match(officerJs, /nextStatus = "Under Review"/);
  assert.match(officerJs, /Assign the complaint classification before sending USC feedback/);
});

test("browser and trusted backend enforce supported complaint classification levels", () => {
  for (const level of ["Student Level", "Administrative Level", "Crisis Level"]) {
    assert.match(securityJs, new RegExp(level));
    assert.match(rules, new RegExp(level));
  }
  assert.match(securityJs, /Assign a complaint classification before moving the case beyond review/);
  assert.match(securityJs, /kind:\s*"feedback"/);
  assert.match(rules, /validComplaintClassification/);
  assert.match(rules, /hasOnly\(\["status", "classification", "updatedAt", "thread"\]\)/);
});

test("student tracklist exposes classification and USC feedback without a student reply control", () => {
  assert.match(tracklistHtml, /<th>Classification<\/th>/);
  assert.match(tracklistHtml, /USC FEEDBACK/);
  assert.match(tracklistJs, /Pending Classification/);
  assert.match(tracklistJs, /No USC feedback yet/);
  assert.match(tracklistJs, /This complaint thread is one-way/);
  assert.doesNotMatch(tracklistHtml, /Send Reply|Reply to USC|Student Reply/);
});

test("complaint notifications react to classification and feedback updates", () => {
  assert.match(notificationsJs, /classification \|\| "pending"/);
  assert.match(notificationsJs, /feedbackCount/);
  assert.match(notificationsJs, /USC feedback is available in your Tracklist/);
  assert.match(notificationsJs, /dashboardHref\("tracklist\.html"\)/);
});
