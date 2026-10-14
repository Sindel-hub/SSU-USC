import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../dashboard/election.html", import.meta.url), "utf8");

test("ineligible students receive a simple election message without action cards", () => {
  assert.match(js, /if \(!eligibility\.allowed\) \{/);
  assert.match(js, /class="election-ineligible-message"/);
  assert.match(js, /You are not eligible to vote in this election\./);
  const branch = js.slice(js.indexOf('if (!eligibility.allowed) {'), js.indexOf('const canRegister = context?.registrationOpen'));
  assert.doesNotMatch(branch, /Election Actions/);
  assert.doesNotMatch(branch, /detailsCard\(\)/);
  assert.doesNotMatch(branch, /Not eligible/);
});

test("simple ineligible state is styled and cache-busted", () => {
  assert.match(css, /STUDENT ELECTION SIMPLE INELIGIBLE STATE - 2026-09-05/);
  assert.match(css, /\.election-page-ineligible \.election-ineligible-message/);
  assert.match(html, /student-pages\.css\?v=election-simple-3/);
  assert.match(html, /election\.js\?v=election-simple-3/);
});
