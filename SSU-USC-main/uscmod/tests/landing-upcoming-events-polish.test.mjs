import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../home/home.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../home/css/home.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../home/js/home.js", import.meta.url), "utf8");

test("upcoming events uses polished two-column showcase", () => {
  assert.match(html, /events-showcase/);
  assert.match(html, /events-overview/);
  assert.match(html, /calendar-card-polished/);
  assert.match(html, /USC CAMPUS CALENDAR/);
  assert.match(css, /LANDING UPCOMING EVENTS POLISH PASS - 2026-09-05/);
  assert.match(css, /grid-template-columns: minmax\(0, \.88fr\) minmax\(470px, 1\.12fr\)/);
});

test("landing event cards expose polished date and venue facts", () => {
  assert.match(js, /event-description-kicker/);
  assert.match(js, /event-facts/);
  assert.match(js, /fa-location-dot/);
  assert.match(css, /\.event-accent/);
});

test("landing assets are cache-busted for polished events", () => {
  assert.match(html, /home\.css\?v=8/);
  assert.match(html, /home\.js\?v=8/);
});
