import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/election.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("ineligible election state renders only the hero message", () => {
  const start = js.indexOf('if (!eligibility.allowed)');
  const end = js.indexOf('const canRegister', start);
  const block = js.slice(start, end);
  assert.match(block, /election-ineligible-hero/);
  assert.match(block, /election-ineligible-overlay-message/);
  assert.match(block, /You are not eligible to vote in this election\./);
  assert.doesNotMatch(block, /timeline\(\)/);
  assert.doesNotMatch(block, /registration-layout/);
  assert.doesNotMatch(block, /election-detail-card/);
});

test("eligibility message is centered inside election hero", () => {
  assert.match(css, /STUDENT ELECTION INELIGIBLE HERO-ONLY STATE/);
  assert.match(css, /\.election-page-ineligible \.election-ineligible-hero\{[\s\S]*?display:grid;[\s\S]*?place-items:center;/);
  assert.match(css, /\.election-ineligible-overlay-message\{[\s\S]*?position:relative;[\s\S]*?z-index:2;/);
});

test("election page cache-busts hero-only state assets", () => {
  assert.match(html, /student-pages\.css\?v=election-clean-5/);
  assert.match(html, /election\.js\?v=election-clean-5/);
});
