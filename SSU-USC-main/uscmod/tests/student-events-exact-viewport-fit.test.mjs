import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("events assets use exact viewport fit cache version", () => {
  assert.match(html, /student-pages\.css\?v=events-fit-final-6/);
  assert.match(html, /events\.js\?v=events-fit-final-6/);
});

test("events highlight computes remaining viewport height from its real top position", () => {
  assert.match(html, /function syncHighlightViewportHeight\(\)/);
  assert.match(html, /window\.innerHeight - top - 8/);
  assert.match(html, /--events-highlight-viewport-height/);
  assert.match(css, /height:\s*var\(--events-highlight-viewport-height/);
});

test("scroll up shortcut is hidden until upcoming section is meaningfully visible", () => {
  assert.match(html, /const revealLine = window\.innerHeight \* 0\.72/);
  assert.match(html, /events-upcoming-visible/);
  assert.match(css, /body\.events-document-scroll \.events-scroll-up \{[\s\S]*?visibility:\s*hidden !important/);
  assert.match(css, /body\.events-document-scroll\.events-upcoming-visible \.events-scroll-up \{[\s\S]*?visibility:\s*visible !important/);
});
