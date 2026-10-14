import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");

test("student candidate gallery restores slanted flashcard accordion flow", () => {
  assert.match(js, /candidateSlantCard/);
  assert.match(js, /candidate-slant-grid-four/);
  assert.match(js, /wireCandidateFlashcardFlow/);
  assert.match(js, /is-accordion-active/);
  assert.match(js, /is-expanded/);
  assert.match(js, /is-collapsed/);
  assert.match(css, /STUDENT ELECTION CANDIDATE FLASHCARD FLOW - 2026-09-08/);
  assert.match(css, /candidate-slant-grid-four\.is-accordion-active/);
});

test("vote action remains wired from the candidate gallery", () => {
  assert.match(js, /id="floatingVoteStatus"/);
  assert.match(js, /renderBallot\(\)/);
  assert.match(css, /\.candidate-vote-button/);
});
