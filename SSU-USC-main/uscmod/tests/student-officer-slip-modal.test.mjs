import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studentHtml = fs.readFileSync(new URL("../usc-admin/student-registration/student-registration.html", import.meta.url), "utf8");
const officerHtml = fs.readFileSync(new URL("../usc-admin/student-registration/officer-registration.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/student-registration/css/student-registration.css", import.meta.url), "utf8");
const studentJs = fs.readFileSync(new URL("../usc-admin/student-registration/js/student-registration.js", import.meta.url), "utf8");
const officerJs = fs.readFileSync(new URL("../usc-admin/student-registration/js/officer-registration.js", import.meta.url), "utf8");

test("student registration hands off a private single-use activation link", () => {
  assert.match(studentHtml, /id="activationHandoff" hidden/);
  assert.match(studentJs, /studentRegistrationIssue/);
  assert.match(studentJs, /link\.value = ''/);
});
test("old officer registration links redirect to promotion without issuing credentials", () => {
  assert.match(officerHtml, /location\.replace/);
  assert.match(officerHtml, /officer-management\.html/);
  assert.doesNotMatch(officerHtml, /<form|officer-registration\.js|temporaryPassword/);
});

test("shared registration CSS defines slip modal styles", () => {
  assert.match(css, /\.slip-modal-overlay\{/);
  assert.match(css, /body\.modal-open\{overflow:hidden\}/);
  assert.match(css, /\.slip-modal-card\{/);
});
