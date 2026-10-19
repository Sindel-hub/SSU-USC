import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/audit-modern.css", import.meta.url), "utf8");

test("report status metrics use a non-overlapping stacked structure", () => {
  assert.match(html, /report-status-copy[\s\S]*?report-status-label[\s\S]*?report-status-value/);
  assert.match(html, /Latest 100 loaded records/);
  assert.match(html, /Last 7 days/);
  assert.doesNotMatch(html, /metric-badge metric-green|metric-badge metric-red/);
  assert.match(css, /report-status-metric[^}]*min-width:0/);
});

test("audit page cache-busts the corrected report status CSS", () => {
  assert.match(html, /audit-modern\.css\?v=1/);
});
