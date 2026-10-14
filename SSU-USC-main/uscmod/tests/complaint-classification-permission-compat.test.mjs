import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const security = fs.readFileSync(new URL("../shared/security-client.js", import.meta.url), "utf8");
const officer = fs.readFileSync(new URL("../usc-admin/complaints/js/complaints.js", import.meta.url), "utf8");
const tracklist = fs.readFileSync(new URL("../dashboard/js/tracklist.js", import.meta.url), "utf8");
const notifications = fs.readFileSync(new URL("../dashboard/js/notifications.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../usc-admin/complaints/complaints.html", import.meta.url), "utf8");

test("complaint review does not require a second protected complaint read before saving", () => {
  const start = security.indexOf("async function browserUpdateComplaintStatus");
  const end = security.indexOf("async function browserDeleteComplaintCase", start);
  const block = security.slice(start, end);
  assert.doesNotMatch(block, /getDoc\(complaintRef\)/, "review save should use the already-selected complaint state from the USC UI");
  assert.match(officer, /previousStatus,/);
  assert.match(officer, /previousClassification,/);
});

test("complaint review supports both current and original deployed rule shapes", () => {
  const start = security.indexOf("async function browserUpdateComplaintStatus");
  const end = security.indexOf("async function browserDeleteComplaintCase", start);
  const block = security.slice(start, end);
  assert.match(block, /await updateDoc\(complaintRef, modernPatch\)/);
  assert.match(block, /legacyPatch\.thread\s*=\s*arrayUnion/);
  assert.match(block, /kind:\s*"classification"/);
  assert.match(block, /await updateDoc\(complaintRef, legacyPatch\)/);
});

test("audit logging cannot roll back a successful complaint review", () => {
  const start = security.indexOf("async function browserUpdateComplaintStatus");
  const end = security.indexOf("async function browserDeleteComplaintCase", start);
  const block = security.slice(start, end);
  assert.doesNotMatch(block, /writeBatch\(db\)/);
  assert.match(block, /Complaint review saved, but its audit entry was blocked/);
  assert.match(block, /Complaint review saved in compatibility mode; audit log was not permitted/);
});

test("USC feedback can use legacy rules without losing the selected classification", () => {
  const start = security.indexOf("async function browserComplaintReply");
  const end = security.indexOf("async function browserSaveElectionSchedule", start);
  const block = security.slice(start, end);
  assert.doesNotMatch(block, /getDoc\(ref\)/);
  assert.match(block, /const feedbackEntry = \{[\s\S]*?kind:\s*"feedback"[\s\S]*?classification,/);
  assert.match(block, /Original rules compatibility format/);
  assert.match(block, /thread:\s*arrayUnion\(feedbackEntry\)/);
});

test("officer and student views recover classification from complaint thread compatibility entries", () => {
  assert.match(officer, /function complaintClassificationForRecord/);
  assert.match(officer, /thread\[index\]\?\.classification/);
  assert.match(tracklist, /function complaintClassificationForRecord/);
  assert.match(tracklist, /thread\[index\]\?\.classification/);
});

test("classification audit entries are not misreported as USC feedback", () => {
  assert.match(tracklist, /kind\)\.toLowerCase\(\) !== 'classification'/);
  assert.match(notifications, /kind\)\.toLowerCase\(\)!=="classification"/);
});

test("USC complaint page cache-busts the corrected permission adapter", () => {
  assert.match(officer, /security-client\.js\?v=classification-permission-2/);
  assert.match(html, /js\/complaints\.js\?v=4/);
});
