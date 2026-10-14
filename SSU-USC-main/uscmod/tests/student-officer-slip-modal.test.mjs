import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studentHtml = fs.readFileSync(new URL("../usc-admin/student-registration/student-registration.html", import.meta.url), "utf8");
const officerHtml = fs.readFileSync(new URL("../usc-admin/student-registration/officer-registration.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/student-registration/css/student-registration.css", import.meta.url), "utf8");
const studentJs = fs.readFileSync(new URL("../usc-admin/student-registration/js/student-registration.js", import.meta.url), "utf8");
const officerJs = fs.readFileSync(new URL("../usc-admin/student-registration/js/officer-registration.js", import.meta.url), "utf8");

test("student registration uses floating credential modal", () => {
  assert.match(studentHtml, /class="slip-section slip-modal-overlay"/);
  assert.match(studentHtml, /id="closeSlipModalBtn"/);
  assert.match(studentJs, /function openSlipModal\(/);
  assert.match(studentJs, /function printSlip\(/);
  assert.match(studentJs, /closeSlipModal\(\)/);
});

test("officer registration uses floating credential modal", () => {
  assert.match(officerHtml, /class="slip-section slip-modal-overlay"/);
  assert.match(officerHtml, /id="closeOfficerSlipModalBtn"/);
  assert.match(officerJs, /function openSlipModal\(/);
  assert.match(officerJs, /function printSlip\(/);
  assert.match(officerJs, /closeSlipModal\(\)/);
});

test("shared registration CSS defines slip modal styles", () => {
  assert.match(css, /\.slip-modal-overlay\{/);
  assert.match(css, /body\.modal-open\{overflow:hidden\}/);
  assert.match(css, /\.slip-modal-card\{/);
});
