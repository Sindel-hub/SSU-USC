import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const electionJs = fs.readFileSync(new URL("../dashboard/js/election.js", import.meta.url), "utf8");
const security = fs.readFileSync(new URL("../shared/security-client.js", import.meta.url), "utf8");
const functions = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const usersHtml = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const usersJs = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-users.js", import.meta.url), "utf8");

test("student election separates universal voting from candidacy approval", () => {
  assert.match(electionJs, /Every active, approved school-provisioned student can vote/);
  assert.match(electionJs, /student\?\.candidacyApproved === true/);
  assert.match(electionJs, /Candidacy Approval Required/);
  assert.match(electionJs, /Approved for candidacy|candidacy registration is approved/i);
});

test("browser and cloud ballot submission no longer require voter-roster eligibility", () => {
  const browserVote = security.slice(security.indexOf("async function browserSubmitBallot"), security.indexOf("async function browserFinalizeElection"));
  assert.doesNotMatch(browserVote, /rosterSnap\.data\(\)\.eligible|not an eligible voter/i);
  assert.match(browserVote, /school-provided student account is required to vote/i);
  const cloudVote = functions.slice(functions.indexOf("exports.submitAnonymousBallot"), functions.indexOf("exports.finalizeElection"));
  assert.doesNotMatch(cloudVote, /rosterIsEligible|active eligible voter/i);
  assert.match(cloudVote, /school-provided student account is required to vote/i);
});

test("candidate registration requires explicit admin candidacy approval", () => {
  assert.match(security, /profile\.candidacyApproved !== true/);
  assert.match(functions, /user\.candidacyApproved !== true/);
  assert.match(rules, /ownProfile\(\)\.candidacyApproved == true/);
});

test("admin user editor exposes candidacy approval separately", () => {
  assert.match(usersHtml, /Approved for candidacy/);
  assert.match(usersHtml, /id="candidacyToggle"/);
  assert.match(usersJs, /candidacyApproved/);
});

test("Firestore voting writes use schoolStudent rather than verifiedStudent", () => {
  const electionRules = rules.slice(rules.indexOf("match /elections/{electionId}"));
  assert.match(electionRules, /match \/ballots\/\{ballotId\}[\s\S]*?allow create: if schoolStudent\(\)/);
  assert.match(electionRules, /match \/voterStatus\/\{userId\}[\s\S]*?allow create: if schoolStudent\(\)/);
});
