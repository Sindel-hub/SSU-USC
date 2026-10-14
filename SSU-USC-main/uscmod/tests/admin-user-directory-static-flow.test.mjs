import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("selected user panel no longer uses sticky positioning", () => {
  assert.doesNotMatch(html, /class="card sticky-card user-directory-editor-card"/);
  assert.match(html, /class="card user-directory-editor-card"/);
  const fix = css.slice(css.indexOf("USER DIRECTORY STATIC FLOW + EMPTY SPACE FIX"));
  assert.match(fix, /\.user-directory-editor-card\s*\{[\s\S]*?position:\s*static\s*!important;[\s\S]*?max-height:\s*none\s*!important;/);
});

test("provisioning and directory cards use a single static flow without empty grid columns", () => {
  const fix = css.slice(css.indexOf("USER DIRECTORY STATIC FLOW + EMPTY SPACE FIX"));
  assert.match(fix, /\.user-directory-hero\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)\s*!important;[\s\S]*?"search"[\s\S]*?"provision"[\s\S]*?"bulk"/);
  assert.match(fix, /\.user-directory-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)\s*!important;/);
  assert.match(fix, /\.directory-editor-empty\s*\{[\s\S]*?min-height:\s*0\s*!important;[\s\S]*?padding:\s*38px 24px\s*!important;/);
});

test("user directory cache-busts the static-flow CSS", () => {
  assert.match(html, /admin-dashboard\.css\?v=(?:user-directory-3|candidacy-1|directory-search-1)/);
});
