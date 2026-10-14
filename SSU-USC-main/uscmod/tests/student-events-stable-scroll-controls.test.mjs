import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("Events highlight height uses document-space position", () => {
  assert.match(html, /const documentTop = highlight\.getBoundingClientRect\(\)\.top \+ window\.scrollY;/);
  assert.match(html, /window\.innerHeight - documentTop - 8/);
});

test("Scroll up returns to the original Events page position", () => {
  assert.match(html, /let eventsInitialScrollTop = window\.scrollY;/);
  assert.match(html, /function scrollToHighlightTop\(\)/);
  assert.match(html, /window\.scrollTo\(\{ top: Math\.max\(0, eventsInitialScrollTop\), behavior: "smooth" \}\);/);
  assert.match(html, /up\?\.addEventListener\("click", scrollToHighlightTop\)/);
});

test("Scroll down control has a stable bottom position", () => {
  const start = css.lastIndexOf("STUDENT EVENTS STABLE HIGHLIGHT CONTROLS");
  const block = css.slice(start);
  assert.match(block, /\.events-highlight-bottom \{[\s\S]*?bottom: 22px !important;/);
  assert.match(block, /\.events-section-jump\.events-scroll-down:hover,[\s\S]*?transform: none !important;/);
});

test("Events assets are cache-busted", () => {
  assert.match(html, /student-pages\.css\?v=events-stable-scroll-7/);
  assert.match(html, /events\.js\?v=events-stable-scroll-7/);
});
