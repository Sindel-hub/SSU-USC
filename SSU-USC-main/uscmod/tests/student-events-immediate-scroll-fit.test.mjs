import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("scroll shortcut binds immediately in HTML before Firebase module", () => {
  const inlineIndex = html.indexOf("function scrollToEventsSection(section)");
  const moduleIndex = html.indexOf('src="js/events.js?v=events-scroll-final-5"');
  assert.ok(inlineIndex >= 0);
  assert.ok(moduleIndex > inlineIndex);
  assert.match(html, /eventsScrollDown/);
  assert.match(html, /window\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: "smooth" \}\)/);
});

test("Firebase events module no longer owns section-scroll timing", () => {
  assert.doesNotMatch(js, /bindSectionNavigation/);
  assert.doesNotMatch(js, /scrollDownButton/);
  assert.doesNotMatch(js, /scrollUpButton/);
});

test("desktop highlight fills the available viewport", () => {
  const start = css.lastIndexOf("STUDENT EVENTS VIEWPORT + IMMEDIATE SCROLL FINAL FIX");
  const block = css.slice(start);
  assert.match(block, /height:\s*calc\(100vh - var\(--student-global-header-h, 74px\) - var\(--student-module-toolbar-h, 58px\) - 12px\) !important;/);
  assert.match(block, /\.events-scroll-up\s*\{[\s\S]*?visibility:\s*hidden !important;/);
  assert.match(block, /events-upcoming-visible \.events-scroll-up\s*\{[\s\S]*?visibility:\s*visible !important;/);
});
