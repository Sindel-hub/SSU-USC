import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/audit-modern.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-audit.js", import.meta.url), "utf8");

test("audit history summary uses a balanced single header", () => {
  assert.match(html, /audit-history-summary-header/);
  assert.match(html, /id="auditHistoryTitle"/);
  assert.match(html, /audit-history-summary-actions/);
  assert.match(css, /audit-history-summary-card[^}]*display:grid/);
});

test("audit search input reserves space for its icon", () => {
  assert.match(css, /#auditSearchInput \{[^}]*padding:11px 38px !important;/);
});

test("audit records viewer owns its scroll area and resets it on open", () => {
  assert.match(css, /audit-records-list-wrap[^}]*overflow:auto;/);
  assert.match(js, /auditRecordsListWrap/);
  assert.match(js, /auditRecordsListWrap\.scrollTop = 0/);
});

test("audit viewer cache-busts the refined CSS", () => {
  assert.match(html, /audit-modern\.css\?v=1/);
});
