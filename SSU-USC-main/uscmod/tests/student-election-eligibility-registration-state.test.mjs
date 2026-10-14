import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../dashboard/election.html", import.meta.url), "utf8");

test("ineligible voter message has priority over registration availability", () => {
  assert.match(js, /reason: "ineligible", message: "You are not eligible to vote in this election\."/);
  const start = js.indexOf("function renderLanding()");
  const end = js.indexOf("function renderRegistration", start);
  const block = js.slice(start, end);
  assert.ok(block.indexOf("if (!eligibility.allowed)") < block.indexOf("if (!context?.registrationOpen)"));
});

test("eligible student sees closed message when registration is not open", () => {
  const start = js.indexOf("function renderLanding()");
  const end = js.indexOf("function renderRegistration", start);
  const block = js.slice(start, end);
  assert.match(block, /if \(!context\?\.registrationOpen\) \{[\s\S]*?renderElectionBlockingState\("Election is not open\.", "closed"\)/);
});

test("eligible student sees the classic registration landing while registration is open", () => {
  assert.match(js, /const primaryLabel = hasApplication \? "Already Registered" : "Register as Candidate";/);
  assert.match(js, /election-reference-landing/);
});

test("election assets are cache-busted for state logic", () => {
  assert.match(html, /student-pages\.css\?v=election-state-4/);
  assert.match(html, /election\.js\?v=election-state-4/);
});
