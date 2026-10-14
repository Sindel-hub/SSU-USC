import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");
const usersJs = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-users.js", import.meta.url), "utf8");
const coreJs = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-core.js", import.meta.url), "utf8");

test("directory exposes one prominent name or student ID search", () => {
  assert.match(html, /id="userSearchInput"[^>]*placeholder="Search by student ID or name"/);
  assert.match(html, /Enter a full or partial student ID, first name, or last name/);
  assert.doesNotMatch(html, /id="roleFilterSelect"/);
  assert.doesNotMatch(html, /id="statusFilterSelect"/);
  assert.doesNotMatch(html, /id="verifiedFilterSelect"/);
  assert.doesNotMatch(html, /id="activeFilterSelect"/);
  assert.doesNotMatch(html, /id="recentFilterSelect"/);
});

test("directory search filters only by full name or student ID", () => {
  assert.match(coreJs, /const name = String\(user\.fullName \|\| ""\)\.toLowerCase\(\);/);
  assert.match(coreJs, /const studentId = String\(user\.studentId \|\| ""\)\.toLowerCase\(\);/);
  assert.match(coreJs, /return name\.includes\(queryText\) \|\| studentId\.includes\(queryText\);/);
});

test("removed filter controls default to all while search and sort remain live", () => {
  assert.match(usersJs, /role: "all"/);
  assert.match(usersJs, /status: "all"/);
  assert.match(usersJs, /verified: "all"/);
  assert.match(usersJs, /active: "all"/);
  assert.match(usersJs, /recent: "all"/);
  assert.match(usersJs, /\[dom\.userSearchInput, dom\.sortSelect\]/);
});

test("simple search receives dedicated responsive styling and cache version", () => {
  assert.match(html, /admin-dashboard\.css\?v=directory-search-1/);
  assert.match(html, /admin-users\.js\?v=directory-search-1/);
  assert.match(css, /USER DIRECTORY SIMPLE NAME \/ STUDENT ID SEARCH - 2026-09-06/);
  assert.match(css, /\.directory-search-control #userSearchInput/);
});
