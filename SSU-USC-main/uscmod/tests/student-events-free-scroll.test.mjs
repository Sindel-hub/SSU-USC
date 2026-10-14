import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");

test("Events page loads free-scroll assets", () => {
  assert.match(html, /student-pages\.css\?v=events-free-scroll-3/);
  assert.match(html, /events\.js\?v=events-free-scroll-3/);
});

test("Events module uses native vertical scrolling without snap behavior", () => {
  const block = css.slice(css.lastIndexOf("STUDENT EVENTS TRUE FREE SCROLL"));
  assert.match(block, /\.events-page-main \{[\s\S]*?overflow-y: auto !important;/);
  assert.match(block, /scroll-snap-type: none !important;/);
  assert.match(block, /touch-action: pan-y pinch-zoom !important;/);
  assert.match(block, /\.events-snap-track \{[\s\S]*?display: block !important;/);
});

test("Events JS has no wheel or touchmove interception", () => {
  assert.doesNotMatch(js, /addEventListener\(["']wheel["']/);
  assert.doesNotMatch(js, /addEventListener\(["']touchmove["']/);
  assert.doesNotMatch(js, /preventDefault\(\)/);
  assert.match(js, /Optional shortcut buttons only/);
});
