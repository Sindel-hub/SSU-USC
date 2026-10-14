import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/complaints/complaints.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/complaints/js/complaints.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/complaints/css/complaints.css", import.meta.url), "utf8");

test("complaints module includes classification and program analytics", () => {
  assert.match(html, /id="departmentComplaintChart"/);
  assert.match(html, /id="analyticsStudentLevelStudents"/);
  assert.match(html, /id="analyticsAdministrativeStudents"/);
  assert.match(html, /id="analyticsCrisisStudents"/);
  assert.match(html, /id="programAnalyticsList"/);
  assert.match(html, /Academic Breakdown/);
});

test("complaint analytics counts unique students and groups programs", () => {
  assert.match(js, /function complaintStudentKey\(/);
  assert.match(js, /departmentSummary\(normalized\)/);

  assert.match(js, /new Set\(normalized\.map\(complaintStudentKey\)/);

  assert.match(js, /function bindComplaintAnalytics\(/);
  assert.match(js, /collection\(db, "complaints"\)/);
});

test("complaint analytics has responsive dashboard styling", () => {
  assert.match(css, /COMPLAINT ANALYTICS - 2026-09-06/);
  assert.match(css, /\.complaint-classification-analytics/);
  assert.match(css, /\.program-analytics-row/);
  assert.match(css, /max-height:\s*360px/);
});

test("complaints page cache busts analytics stylesheet", () => {
  assert.match(html, /complaint-workspace\.css\?v=\d+/);
});
