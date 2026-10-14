import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("audit page cache-busts the polished viewer CSS", () => {
  assert.match(html, /admin-dashboard\.css\?v=audit-records-modal-3/);
});

test("audit viewer dialog is centered and polished", () => {
  assert.match(css, /ADMIN AUDIT VIEWER CENTER \+ POLISH - 2026-09-05/);
  assert.match(css, /\.audit-records-dialog \{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*50% auto auto 50%;[\s\S]*?transform:\s*translate\(-50%, -50%\);/);
  assert.match(css, /\.audit-search-control input,[\s\S]*?min-height:\s*54px/);
  assert.match(css, /\.audit-records-count \{[\s\S]*?min-height:\s*64px/);
});
