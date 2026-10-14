import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");

test("student Events renders Highlight and Upcoming Events in one natural vertical flow", () => {
  assert.doesNotMatch(html, /id="eventsUpcomingSection" hidden/);
  assert.match(css, /STUDENT EVENTS NATURAL SCROLL FLOW - 2026-09-05/);
  assert.match(css, /\.events-snap-viewport \{[\s\S]*?height: auto !important;[\s\S]*?touch-action: pan-y pinch-zoom !important;/);
  assert.match(css, /\.events-snap-section,[\s\S]*?position: relative !important;/);
});

test("Scroll down and Scroll up buttons smoothly align their target section", () => {
  assert.match(js, /function scrollSectionIntoView\(section\)/);
  assert.match(js, /eventsPageMain\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: "smooth" \}\)/);
  assert.match(js, /section\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(js, /scrollDownButton\?\.addEventListener\("click", \(\) => scrollSectionIntoView\(upcomingSection\)\)/);
  assert.match(js, /scrollUpButton\?\.addEventListener\("click", \(\) => scrollSectionIntoView\(highlightSection\)\)/);
});

test("normal wheel and touch scrolling are not intercepted for section switching", () => {
  assert.doesNotMatch(js, /snapViewport\?\.addEventListener\("wheel"/);
  assert.doesNotMatch(js, /sectionTouchStartY/);
  assert.doesNotMatch(js, /activeSection/);
  assert.doesNotMatch(js, /setSection\(/);
});

test("Events page cache busts natural-scroll assets", () => {
  assert.match(html, /student-pages\.css\?v=events-natural-scroll-1/);
  assert.match(html, /events\.js\?v=events-natural-scroll-1/);
});
