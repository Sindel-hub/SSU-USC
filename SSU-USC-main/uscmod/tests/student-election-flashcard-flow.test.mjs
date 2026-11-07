import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/election-polish.css", import.meta.url), "utf8");

test("candidate gallery replaces resizing accordions with stable cards and sliding information", () => {
  assert.match(js, /candidateGalleryCard/);
  assert.match(js, /wireCandidateGallery/);
  assert.doesNotMatch(js, /activateCandidateAccordion|candidate-slant-grid-four/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /transition:\s*transform \.25s ease/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("vote action remains wired from the centered candidate gallery control", () => {
  assert.match(js, /id="floatingVoteStatus"/);
  assert.match(js, /renderBallot\(\)/);
  assert.match(css, /justify-content:\s*center/);
});
