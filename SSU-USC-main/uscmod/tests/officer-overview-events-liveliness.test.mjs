import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/overview/overview.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/overview/css/overview.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/overview/js/overview.js", import.meta.url), "utf8");

test("officer overview cache-busts lively events assets", () => {
  assert.match(html, /overview\.css\?v=officer-liveliness-1/);
  assert.match(html, /overview\.js\?v=officer-liveliness-1/);
});

test("officer overview includes lively event card styles and rendering", () => {
  assert.match(css, /OFFICER OVERVIEW EVENT LIVELINESS PASS - 2026-09-07/);
  assert.match(css, /\.overview-event-hero\{/);
  assert.match(css, /\.overview-event-insights\{/);
  assert.match(css, /\.overview-event-empty-state\{/);
  assert.match(js, /function eventRegistrationCounts\(\)/);
  assert.match(js, /overview-event-badge primary/);
  assert.match(js, /overview-event-queue-head/);
  assert.match(js, /Create an event to start highlighting participation/);
});
