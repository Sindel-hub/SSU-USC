import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-users.js", import.meta.url), "utf8");

test("user directory page uses the polished dashboard layout", () => {
  assert.match(html, /class="hero user-directory-hero"/);
  assert.match(html, /user-directory-search-card/);
  assert.match(html, /user-directory-provision-card/);
  assert.match(html, /user-directory-bulk-card/);
  assert.match(html, /user-directory-workspace/);
  assert.match(html, /admin-dashboard\.css\?v=(?:user-directory-3|candidacy-1|directory-search-1)/);
});

test("directory table renders identity avatars and selected row state", () => {
  assert.match(js, /class="directory-row \$\{selectedUserId === user\.uid \? 'is-open' : ''\}"/);
  assert.match(js, /class="directory-user-avatar"/);
  assert.match(js, /getInitials\(user\.fullName, user\.email\)/);
});

test("user directory polish keeps responsive and sticky table behavior", () => {
  assert.match(css, /ADMIN USER DIRECTORY POLISH - 2026-09-05/);
  assert.match(css, /\.user-directory-table-card thead th \{[\s\S]*?position:\s*sticky;/);
  assert.match(css, /\.directory-row\.is-open td:first-child \{[\s\S]*?box-shadow:\s*inset 4px 0 0/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.user-editor-fields-grid/);
});
