import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const eventsHtml = fs.readFileSync(new URL("../usc-admin/events/events.html", import.meta.url), "utf8");
const eventsCss = fs.readFileSync(new URL("../usc-admin/events/css/events.css", import.meta.url), "utf8");
const complaintsHtml = fs.readFileSync(new URL("../usc-admin/complaints/complaints.html", import.meta.url), "utf8");
const complaintsCss = fs.readFileSync(new URL("../usc-admin/complaints/css/complaints.css", import.meta.url), "utf8");

test("events module mounts Complaint-style status cards and retains summary metric hooks", () => {
  const ui = fs.readFileSync(new URL("../shared/engagement-analytics.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../shared/engagement-analytics.css", import.meta.url), "utf8");
  assert.match(eventsHtml, /id="engagementAnalytics"/);
  assert.match(eventsHtml, /engagement-analytics\.css\?v=1/);
  assert.match(ui, /Status Report/);
  assert.match(ui, /engagement-count-row/);
  for (const id of ["upcomingEventCount", "publishedEventCount", "reminderEnabledCount", "confirmedAttendanceCount"]) assert.ok(ui.includes(`id="${id}"`));
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("complaints module uses the same polished summary card treatment", () => {
  assert.match(complaintsHtml, /class="stats module-summary-stats"/);
  assert.match(complaintsHtml, /fa-regular fa-envelope-open/);
  assert.match(complaintsHtml, /fa-solid fa-magnifying-glass/);
  assert.match(complaintsHtml, /fa-solid fa-spinner/);
  assert.match(complaintsHtml, /fa-regular fa-circle-check/);
  assert.match(complaintsCss, /OFFICER SUMMARY CARDS POLISH PASS - 2026-09-04/);
  assert.match(complaintsCss, /\.module-summary-stats \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
});
