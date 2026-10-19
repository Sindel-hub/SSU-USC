import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/audit-modern.css", import.meta.url), "utf8");

test("admin audit report status uses polished metric cards", () => {
  assert.match(html, /audit-activity-section/);
  assert.match(html, /report-status-grid/);
  assert.match(html, /report-status-icon/);
  assert.match(html, /id="auditRecentChanges"/);
  assert.match(html, /id="auditRoleChanges"/);
  assert.match(html, /id="auditSuspensions"/);
  assert.match(html, /id="auditVerifications"/);
  assert.match(css, /report-status-grid[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /report-status-value[^}]*font-size:32px/);
});

test("report status CSS is cache busted", () => {
  assert.match(html, /audit-modern\.css\?v=1/);
});
