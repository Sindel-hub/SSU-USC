import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/elections/elections.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/elections/css/elections.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/elections/js/elections.js", import.meta.url), "utf8");
const functions = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const browser = fs.readFileSync(new URL("../shared/security-client.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("officer election page shows aggregate department voting participation", () => {
  assert.match(html, /Department Voting Participation/);
  assert.match(html, /id="departmentTurnoutList"/);
  assert.match(html, /Aggregate counts only/);
  assert.match(css, /DEPARTMENT VOTING PARTICIPATION ANALYTICS/);
  assert.match(css, /\.department-turnout-bar/);
});

test("election dashboard requests and renders department turnout securely", () => {
  assert.match(js, /callSecure\("getElectionDepartmentTurnout"/);
  assert.match(js, /function renderDepartmentTurnout\(/);
  assert.match(js, /renderDepartmentTurnout\(\);/);
});

test("server aggregate returns counts only and does not return voter identities", () => {
  assert.match(functions, /exports\.getElectionDepartmentTurnout/);
  assert.match(functions, /where\("hasVoted", "==", true\)/);
  assert.match(functions, /department,\s*voted,/);
  const fnStart = functions.indexOf("exports.getElectionDepartmentTurnout");
  const fnEnd = functions.indexOf("exports.getElectionContext", fnStart);
  const block = functions.slice(fnStart, fnEnd);
  assert.doesNotMatch(block, /studentId\s*:/);
  assert.doesNotMatch(block, /uid\s*:/);
  assert.doesNotMatch(block, /receiptReference\s*:/);
});

test("browser voting records only aggregate department counts in public turnout", () => {
  assert.match(browser, /function browserGetElectionDepartmentTurnout/);
  assert.match(browser, /departmentVotes:\{ \[turnoutDepartment\]:increment\(1\) \}/);
  assert.match(browser, /if \(name === "getElectionDepartmentTurnout"\)/);
  assert.match(functions, /departmentVotes: \{ \[turnoutDepartment\]: FieldValue\.increment\(1\) \}/);
});

test("turnout rules constrain a student's department aggregate increment", () => {
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\["ballotsCast", "departmentVotes", "updatedAt"\]\)/);
  assert.match(rules, /ownProfile\(\)\.college/);
  assert.match(rules, /departmentVotes\[ownProfile\(\)\.college\]/);
});

test("election assets are cache-busted for department analytics", () => {
  assert.match(html, /elections\.css\?v=candidate-preview-modal-1/);
  assert.match(html, /elections\.js\?v=candidate-preview-modal-1/);
});
