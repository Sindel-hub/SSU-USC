import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dashboard/election.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("student election page loads the reference UI assets", () => {
  assert.match(html, /student-pages\.css\?v=election-state-4/);
  assert.match(html, /election\.js\?v=election-state-4/);
});

test("candidate registration uses a four-step wizard", () => {
  assert.match(js, /function candidateStepper\(step\)/);
  assert.match(js, /PERSONAL INFORMATION/);
  assert.match(js, /Campaign Photo/);
  assert.match(js, /Statement of Intent/);
  assert.match(js, /REVIEW &amp; SUBMIT/);
  assert.match(js, /candidateRegistrationStep === 4/);
});

test("election landing matches the reference hero and registered state", () => {
  assert.match(js, /A Legacy of Student Leadership/);
  assert.match(js, /Already Registered/);
  assert.match(js, /election-reference-landing/);
  assert.match(css, /STUDENT ELECTION REFERENCE UI - 2026-09-05/);
  assert.match(css, /\.candidate-registration-layout\s*\{/);
  assert.match(css, /\.candidate-registration-details\s*\{/);
});

test("candidate submission preserves existing secure upload flow", () => {
  assert.match(js, /secureUpload\(candidateDraft\.photoFile, "candidate-photo"\)/);
  assert.match(js, /secureUpload\(file, "candidate-document"\)/);
  assert.match(js, /callSecure\("submitCandidateApplication"/);
});
