import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

const marker = "STUDENT EVENTS MOBILE SINGLE-SCROLLER FIX";
const start = css.lastIndexOf(marker);
const block = start >= 0 ? css.slice(start) : "";

test("Events page cache-busts the mobile scroll fix", () => {
  assert.match(html, /student-pages\.css\?v=events-mobile-scroll-2/);
});

test("mobile Upcoming Events is not a nested vertical scroller", () => {
  assert.ok(start >= 0, "mobile single-scroller CSS block should exist");
  assert.match(block, /\.events-upcoming-section\s*\{[\s\S]*?overflow-y:\s*visible !important;[\s\S]*?scrollbar-gutter:\s*auto !important;/);
  assert.match(block, /\.events-upcoming-content\s*\{[\s\S]*?height:\s*auto !important;[\s\S]*?overflow:\s*visible !important;/);
});

test("mobile Events wrappers permit native vertical pan", () => {
  assert.match(block, /touch-action:\s*pan-y pinch-zoom !important;/);
  assert.match(block, /body\.student-app-shell\.events-document-scroll[\s\S]*?overflow-y:\s*visible !important;/);
  assert.match(block, /html\s*\{[\s\S]*?overflow-y:\s*auto !important;/);
});

test("decorative event layers cannot intercept mobile drag gestures", () => {
  assert.match(block, /\.events-upcoming-background,[\s\S]*?\.events-upcoming-shade\s*\{[\s\S]*?pointer-events:\s*none !important;/);
});
