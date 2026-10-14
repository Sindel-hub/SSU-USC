import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("events page loads polished highlight assets", () => {
  assert.match(html, /student-pages\.css\?v=events-highlight-polish-1/);
  assert.match(html, /events\.js\?v=events-highlight-polish-1/);
});

test("event highlight uses centered polished event card", () => {
  assert.match(css, /STUDENT EVENTS HIGHLIGHT UI POLISH - 2026-09-05/);
  assert.match(css, /\.events-highlight-center \{[\s\S]*?border-radius: 26px;[\s\S]*?backdrop-filter: blur\(12px\);/);
  assert.match(css, /\.events-section-jump\.events-scroll-down \{[\s\S]*?border-radius: 999px;/);
  assert.match(css, /\.events-highlight-nav \{[\s\S]*?width: 48px;[\s\S]*?height: 48px;/);
});
