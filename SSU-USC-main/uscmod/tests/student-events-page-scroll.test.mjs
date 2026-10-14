import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");

test("events page opts into document-level scrolling", () => {
  assert.match(html, /<body class="student-app-shell events-document-scroll">/);
  assert.match(html, /student-pages\.css\?v=events-page-scroll-4/);
  assert.match(html, /events\.js\?v=events-page-scroll-4/);
});

test("desktop Events module no longer owns a fixed-height inner scrollbar", () => {
  const start = css.lastIndexOf("STUDENT EVENTS PAGE-LEVEL SCROLL FIX");
  const block = css.slice(start);
  assert.match(block, /\.dashboard-layout\s*\{[\s\S]*?height:\s*auto !important;[\s\S]*?overflow:\s*visible !important;/);
  assert.match(block, /\.events-page-main\s*\{[\s\S]*?height:\s*auto !important;[\s\S]*?overflow:\s*visible !important;/);
});

test("event jump controls remain optional smooth-scroll shortcuts", () => {
  assert.match(js, /scrollDownButton\?\.addEventListener\("click", \(\) => scrollSectionIntoView\(upcomingSection\)\)/);
  assert.match(js, /scrollUpButton\?\.addEventListener\("click", \(\) => scrollSectionIntoView\(highlightSection\)\)/);
  assert.doesNotMatch(js, /addEventListener\("wheel"/);
  assert.doesNotMatch(js, /preventDefault\(\)/);
});
