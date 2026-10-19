import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/queue.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/queue-modern.css", import.meta.url), "utf8");

test("admin registration queue metrics use a narrow-panel-safe vertical card layout", () => {
  assert.match(html, /queue-metric-card queue-metric-pending/);
  assert.match(html, /class="queue-metric-top"/);
  assert.match(html, /queue-metric-value" id="queuePendingCount/);
  assert.match(html, /fa-solid fa-user-tie/);
  assert.match(css, /queue-metric-card[^}]*min-width:0/);
  assert.match(css, /queue-metric-copy[^}]*flex-direction:column !important/);
});

test("metric labels retain their count hooks without redundant badges", () => {
  for(const id of ['queuePendingCount','queueNewWeekCount','queueUnverifiedCount','queueCandidateCount']) assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/metric-badge metric-amber|metric-badge metric-green/);
});

test("admin queue metrics CSS is cache-busted", () => {
  assert.match(html, /queue-modern\.css\?v=1/);
});
