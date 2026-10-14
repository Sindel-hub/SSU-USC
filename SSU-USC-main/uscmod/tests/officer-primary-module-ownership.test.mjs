import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const permissions = fs.readFileSync(new URL("../shared/officer-permissions.js", import.meta.url), "utf8");
const functions = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../OFFICER_RBAC_README.md", import.meta.url), "utf8");

function presetBlock(source, role) {
  const marker = `"${role}":`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${role} preset should exist`);
  const next = source.indexOf('\n  "', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("President is the default Complaint manager and Elections stay read-only", () => {
  const block = presetBlock(permissions, "President");
  for (const key of [
    "complaints.view", "complaints.review", "complaints.classify",
    "complaints.feedback", "complaints.status", "complaints.report"
  ]) assert.match(block, new RegExp(key.replaceAll('.', '\\.')));
  assert.doesNotMatch(block, /elections\.(view|schedule|roster|review|results)/);
});

test("Vice President is the default Election manager and Complaints stay read-only", () => {
  const block = presetBlock(permissions, "Vice President");
  for (const key of [
    "elections.view", "elections.roster",
    "elections.review", "elections.results"
  ]) assert.match(block, new RegExp(key.replaceAll('.', '\\.')));
  assert.doesNotMatch(block, /complaints\.(view|review|classify|feedback|status|report)/);
});

test("Cloud Functions and Firestore defaults mirror the same primary ownership", () => {
  const presidentFn = presetBlock(functions, "President");
  const viceFn = presetBlock(functions, "Vice President");
  assert.match(presidentFn, /complaints\.classify/);
  assert.doesNotMatch(presidentFn, /elections\.schedule/);
  assert.match(viceFn, /elections\.view/);
  assert.doesNotMatch(viceFn, /complaints\.classify/);

  assert.match(rules, /ownProfile\(\)\.officePosition == "President"[\s\S]*?"complaints\.classify"/);
  assert.match(rules, /ownProfile\(\)\.officePosition == "Vice President"[\s\S]*?"elections\.view"/);
});

test("RBAC documentation explains the primary managers and read-only counterpart", () => {
  assert.match(readme, /Vice President → Election Management/);
  assert.match(readme, /President → Complaint Management/);
  assert.match(readme, /Elections are read-only by default/);
  assert.match(readme, /Complaints are read-only by default/);
});
