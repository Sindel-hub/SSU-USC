import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("event highlight uses position-only cache version", () => {
  assert.match(html, /student-pages\.css\?v=events-highlight-position-2/);
  assert.match(html, /events\.js\?v=events-highlight-position-2/);
});

test("highlight event text is centered without glass card styling", () => {
  const block = css.slice(css.lastIndexOf("STUDENT EVENTS HIGHLIGHT POSITION-ONLY FIX"));
  assert.match(block, /\.events-highlight-center \{[\s\S]*?top: 50% !important;[\s\S]*?left: 50% !important;[\s\S]*?transform: translate\(-50%, -50%\) !important;/);
  assert.match(block, /\.events-highlight-center \{[\s\S]*?background: transparent !important;/);
});

test("side arrows are vertically centered", () => {
  const block = css.slice(css.lastIndexOf("STUDENT EVENTS HIGHLIGHT POSITION-ONLY FIX"));
  assert.match(block, /\.events-highlight-nav \{[\s\S]*?top: 50% !important;[\s\S]*?transform: translateY\(-50%\) !important;/);
});

test("scroll down area is anchored at the bottom center", () => {
  const block = css.slice(css.lastIndexOf("STUDENT EVENTS HIGHLIGHT POSITION-ONLY FIX"));
  assert.match(block, /\.events-highlight-bottom \{[\s\S]*?left: 50% !important;[\s\S]*?bottom: 22px !important;[\s\S]*?transform: translateX\(-50%\) !important;/);
});
