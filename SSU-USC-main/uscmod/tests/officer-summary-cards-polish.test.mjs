import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const eventsHtml = fs.readFileSync(new URL("../usc-admin/events/events.html", import.meta.url), "utf8");
const eventsCss = fs.readFileSync(new URL("../usc-admin/events/css/events.css", import.meta.url), "utf8");
const complaintsHtml = fs.readFileSync(new URL("../usc-admin/complaints/complaints.html", import.meta.url), "utf8");
const complaintsCss = fs.readFileSync(new URL("../usc-admin/complaints/css/complaints.css", import.meta.url), "utf8");

test("events module uses polished icon summary cards", () => {
  assert.match(eventsHtml, /class="stats module-summary-stats"/);
  assert.match(eventsHtml, /fa-regular fa-calendar-plus/);
  assert.match(eventsHtml, /fa-solid fa-bullhorn/);
  assert.match(eventsHtml, /fa-regular fa-bell/);
  assert.match(eventsHtml, /fa-solid fa-user-check/);
  assert.match(eventsCss, /OFFICER SUMMARY CARDS POLISH PASS - 2026-09-04/);
  assert.match(eventsCss, /\.module-stat-card \{[\s\S]*?grid-template-columns: 56px 1fr;/);
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
