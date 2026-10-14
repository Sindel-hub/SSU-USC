import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/queue.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("admin registration queue metrics use a narrow-panel-safe vertical card layout", () => {
  assert.match(html, /queue-metric-card queue-metric-pending/);
  assert.match(html, /class="queue-metric-top"/);
  assert.match(html, /queue-metric-value" id="queuePendingCount/);
  assert.match(html, /fa-solid fa-user-tie/);
  assert.match(css, /REGISTRATION QUEUE METRICS LAYOUT FIX V2 - 2026-09-04/);
  assert.match(css, /\.queue-metrics-grid \.queue-metric-card \{[\s\S]*?display: flex !important;[\s\S]*?flex-direction: column !important;/);
  assert.match(css, /\.queue-metric-top \{[\s\S]*?justify-content: space-between;/);
  assert.match(css, /\.queue-metrics-grid \.queue-metric-label \{[\s\S]*?word-break: normal !important;/);
});

test("status chips are separated from metric labels so they cannot squeeze the label column", () => {
  assert.match(html, /<div class="queue-metric-top">[\s\S]*?metric-amber[\s\S]*?<\/div>[\s\S]*?<div class="queue-metric-copy">/);
  assert.match(html, /<div class="queue-metric-top">[\s\S]*?metric-green[\s\S]*?<\/div>[\s\S]*?<div class="queue-metric-copy">/);
});

test("admin queue metrics CSS is cache-busted", () => {
  assert.match(html, /admin-dashboard\.css\?v=queue-metrics-3/);
});
