import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const guard = fs.readFileSync(new URL("../shared/auth-guard.js", import.meta.url), "utf8");
const election = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../dashboard/election.html", import.meta.url), "utf8");

test("student Election module is viewable even when voter eligibility is false", () => {
  assert.match(guard, /Viewing the Student Election module is part of normal portal access/);
  assert.match(guard, /return path\.includes\("\/voting\/"\)/);
  assert.doesNotMatch(guard, /return path\.includes\("\/dashboard\/election"\) \|\| path\.includes\("\/voting\/"\)/);
  assert.match(guard, /redirectToElection\(/);
  assert.match(election, /function electionActionEligibility\(/);
  assert.match(election, /Election view access/);
});

test("ineligible students cannot register or vote from the Election module", () => {
  assert.match(election, /const canRegister = eligibility\.allowed && context\?\.registrationOpen/);
  assert.match(election, /const canVote = eligibility\.allowed && context\?\.votingOpen/);
  assert.match(election, /if \(!electionActionEligibility\(\)\.allowed \|\| !context\?\.registrationOpen\) return renderLanding\(\)/);
  assert.match(election, /if \(!electionActionEligibility\(\)\.allowed \|\| !context\?\.votingOpen/);
});

test("Election page cache-busts the corrected guard and module", () => {
  assert.match(html, /auth-guard\.js\?v=election-view-1/);
  assert.match(html, /election\.js\?v=election-view-1/);
});
