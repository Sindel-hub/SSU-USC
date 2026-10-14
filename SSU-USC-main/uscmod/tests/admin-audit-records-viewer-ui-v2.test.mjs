import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-audit.js", import.meta.url), "utf8");

test("audit history summary uses a balanced single header", () => {
  assert.match(html, /audit-history-summary-header/);
  assert.match(html, /audit-history-summary-title-group/);
  assert.match(html, /audit-history-summary-actions/);
  assert.match(css, /ADMIN AUDIT VIEWER UI REFINEMENT - 2026-09-05/);
  assert.match(css, /\.audit-history-summary-card \{[\s\S]*?min-height:\s*0;/);
});

test("audit search input reserves space for its icon", () => {
  assert.match(css, /#auditSearchInput \{[\s\S]*?padding:\s*10px 14px 10px 42px !important;/);
});

test("audit records viewer owns its scroll area and resets it on open", () => {
  assert.match(css, /\.audit-records-list-wrap \{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(js, /auditRecordsListWrap/);
  assert.match(js, /auditRecordsListWrap\.scrollTop = 0/);
});

test("audit viewer cache-busts the refined CSS", () => {
  assert.match(html, /admin-dashboard\.css\?v=audit-records-modal-2/);
});
