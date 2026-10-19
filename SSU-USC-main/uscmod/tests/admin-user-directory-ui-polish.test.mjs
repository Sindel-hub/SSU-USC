import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/users-modern.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-users.js", import.meta.url), "utf8");

test("user directory page uses the polished dashboard layout", () => {
  assert.match(html, /class="directory-page-heading"/);
  assert.match(html, /class="directory-search-field"/);
  assert.match(html, /id="schoolAccountProvisionCard"/);
  assert.match(html, /user-directory-bulk-card/);
  assert.match(html, /user-directory-workspace/);
  assert.match(html, /users-modern\.css\?v=1/);
});

test("directory table renders identity avatars and selected row state", () => {
  assert.match(js, /class="directory-row \$\{selectedUserId === user\.uid \? 'is-open' : ''\}"/);
  assert.match(js, /class="directory-user-avatar"/);
  assert.match(js, /getInitials\(user\.fullName, user\.email\)/);
});

test("user directory polish keeps responsive and sticky table behavior", () => {
  assert.match(css, /\.user-directory-table-card thead th \{[^}]*position:sticky/);
  assert.match(css, /\.table-wrap \{[^}]*overflow:auto/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(html, /aria-label="Select all eligible accounts in results"/);
  assert.match(html, /<th scope="col">Name<\/th>/);
  assert.match(html, /aria-label="User accounts — scroll for all columns" tabindex="0"/);
});
