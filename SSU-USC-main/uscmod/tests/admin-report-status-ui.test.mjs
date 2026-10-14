import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("admin audit report status uses polished metric cards", () => {
  assert.match(html, /admin-report-status-card/);
  assert.match(html, /report-status-grid/);
  assert.match(html, /report-status-icon/);
  assert.match(html, /id="auditRecentChanges"/);
  assert.match(html, /id="auditRoleChanges"/);
  assert.match(html, /id="auditSuspensions"/);
  assert.match(html, /id="auditVerifications"/);
  assert.match(css, /ADMIN REPORT STATUS POLISH - 2026-09-04/);
  assert.match(css, /\.report-status-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.report-status-value \{[\s\S]*?font-size: 32px;/);
});

test("report status CSS is cache busted", () => {
  assert.match(html, /admin-dashboard\.css\?v=admin-report-status-2/);
});
