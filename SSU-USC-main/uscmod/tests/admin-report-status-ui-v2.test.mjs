import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("report status metrics use a non-overlapping stacked structure", () => {
  assert.match(html, /class="report-status-top"/);
  assert.match(html, /report-status-top[\s\S]*?metric-badge metric-blue/);
  assert.match(html, /report-status-copy[\s\S]*?report-status-label[\s\S]*?report-status-value/);
  assert.match(css, /ADMIN REPORT STATUS LAYOUT FIX V2/);
  assert.match(css, /\.report-status-metric \{[\s\S]*?flex-direction: column;/);
  assert.match(css, /\.report-status-top \{[\s\S]*?justify-content: space-between;/);
  assert.match(css, /\.report-status-label \{[\s\S]*?word-break: keep-all;/);
});

test("audit page cache-busts the corrected report status CSS", () => {
  assert.match(html, /admin-dashboard\.css\?v=admin-report-status-3/);
});
