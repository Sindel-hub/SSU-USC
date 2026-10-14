import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../dashboard/election.html", import.meta.url), "utf8");

test("ineligible students get one compact eligibility notice", () => {
  assert.match(js, /You are not eligible to vote in this election\./);
  assert.match(js, /election-eligibility-compact/);
  assert.doesNotMatch(js, /Election view access/);
  assert.doesNotMatch(js, /Election information access/);
});

test("ineligible election actions stay disabled without large access panels", () => {
  assert.match(js, /Not eligible/);
  assert.match(css, /STUDENT ELECTION COMPACT ELIGIBILITY NOTICE/);
  assert.match(css, /\.election-eligibility-compact\{/);
});

test("election page cache-busts simplified eligibility UI", () => {
  assert.match(html, /student-pages\.css\?v=election-simple-2/);
  assert.match(html, /election\.js\?v=election-simple-2/);
});
