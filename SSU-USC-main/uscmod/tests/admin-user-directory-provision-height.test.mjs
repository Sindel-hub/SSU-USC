import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("user directory provisioning card no longer stretches to bulk card height", () => {
  assert.match(css, /USER DIRECTORY PROVISIONING HEIGHT FIX - 2026-09-05/);
  assert.match(css, /\.user-directory-hero\s*\{[\s\S]*?align-items:\s*start;/);
  assert.match(css, /\.user-directory-provision-card\s*\{[\s\S]*?align-self:\s*start;[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/);
  assert.match(css, /\.user-directory-provision-card \.action-group\s*\{[\s\S]*?margin-top:\s*0\s*!important;/);
});

test("user directory page cache-busts the compact provisioning CSS", () => {
  assert.match(html, /admin-dashboard\.css\?v=user-directory-3/);
});
