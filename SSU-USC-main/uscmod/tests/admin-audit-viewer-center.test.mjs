import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/audit-modern.css", import.meta.url), "utf8");

test("audit page cache-busts the polished viewer CSS", () => {
  assert.match(html, /audit-modern\.css\?v=1/);
});

test("audit viewer dialog is centered and polished", () => {
  assert.match(css, /audit-records-dialog[^}]*position:fixed !important;[^}]*inset:0 !important;[^}]*margin:auto !important;/);
  assert.match(css, /#auditSearchInput[^}]*height:44px/);
  assert.match(css, /audit-records-count[^}]*min-height:44px/);
});
