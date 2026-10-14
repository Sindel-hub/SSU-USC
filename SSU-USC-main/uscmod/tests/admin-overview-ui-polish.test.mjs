import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/admin-dashboard.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("admin overview uses icon-backed polished metric cards", () => {
  assert.match(html, /class="stats-grid admin-overview-stats"/);
  assert.match(html, /class="stat-card admin-overview-stat stat-total"/);
  assert.match(html, /fa-solid fa-users/);
  assert.match(html, /fa-solid fa-user-check/);
  assert.match(html, /fa-regular fa-clock/);
  assert.match(html, /fa-solid fa-user-slash/);
  assert.match(html, /fa-solid fa-user-tie/);
  assert.match(html, /fa-solid fa-shield-halved/);
  assert.match(css, /ADMIN ACCESS OVERVIEW POLISH - 2026-09-04/);
  assert.match(css, /\.admin-overview-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
});

test("admin overview keeps the existing metric element ids", () => {
  for (const id of ["statTotal","statApproved","statPending","statSuspended","statOfficers","statVerified","statNewWeek","statNeverLogin"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("admin overview cache-busts the polished stylesheet", () => {
  assert.match(html, /admin-dashboard\.css\?v=overview-polish-2/);
});
