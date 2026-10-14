import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/announcements/announcements.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/announcements/css/announcements.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/announcements/js/announcements.js", import.meta.url), "utf8");

test("bulletin summary cards use polished compact analytics structure", () => {
  assert.match(html, /class="stats bulletin-stats"/);
  assert.equal((html.match(/bulletin-stat-card/g) || []).length, 4);
  assert.match(html, /bulletin-stat-icon/);
  assert.match(css, /BULLETIN BOARD SUMMARY CARDS POLISH/);
  assert.match(css, /\.bulletin-stat-card\s*\{[\s\S]*?height:\s*132px\s*!important/);
});

test("latest publish is split into readable date and time", () => {
  assert.match(html, /latest-publish-date/);
  assert.match(html, /latest-publish-time/);
  assert.match(js, /toLocaleDateString\(\[\], \{ month: "short", day: "numeric", year: "numeric" \}\)/);
  assert.match(js, /toLocaleTimeString\(\[\], \{ hour: "numeric", minute: "2-digit" \}\)/);
});

test("bulletin assets are cache-busted after the polish", () => {
  assert.match(html, /css\/announcements\.css\?v=3/);
  assert.match(html, /js\/announcements\.js\?v=3&rbac=readonly-1/);
});
