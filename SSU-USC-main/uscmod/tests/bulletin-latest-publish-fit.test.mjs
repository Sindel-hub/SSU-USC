import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../usc-admin/announcements/css/announcements.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../usc-admin/announcements/announcements.html", import.meta.url), "utf8");

test("latest publish summary does not truncate its date or helper text", () => {
  const fix = css.slice(css.indexOf("LATEST PUBLISH TEXT FIT FIX"));
  assert.match(fix, /\.latest-publish-date\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?text-overflow:\s*clip;/);
  assert.match(fix, /\.latest-publish-card \.stat-sub\s*\{[\s\S]*?white-space:\s*normal\s*!important;[\s\S]*?text-overflow:\s*clip\s*!important;/);
});

test("bulletin stylesheet cache version is bumped", () => {
  assert.match(html, /css\/announcements\.css\?v=4/);
});
