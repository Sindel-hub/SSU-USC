import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("usc-admin/elections/elections.html");
const js = read("usc-admin/elections/js/elections.js");
const security = read("shared/security-client.js");
const functions = read("functions/index.js");
const rules = read("firestore.rules");
const permissions = read("shared/officer-permissions.js");

 test("saved schedule is read-only on the page and edits happen in a preview dialog", () => {
  assert.match(html, /class="card schedule-management-card saved-schedule-card"/);
  assert.match(html, /id="savedPhaseList"/);
  assert.match(html, /id="editScheduleBtn"[^>]*data-rbac-permission="elections\.view"/);
  assert.match(html, /id="scheduleEditorDialog"/);
  assert.match(html, /id="saveElectionSettingsBtn"[^>]*data-rbac-permission="elections\.view"/);
  assert.match(html, /Create Replacement Schedule/);
  assert.doesNotMatch(html, /data-rbac-permission="elections\.schedule"/);
});

test("schedule management actions include delete and create new schedule", () => {
  assert.match(html, /id="deleteCurrentScheduleBtn"/);
  assert.match(html, /id="createNewScheduleBtn"/);
  assert.match(js, /async function deleteCurrentSchedule\(/);
  assert.match(js, /callSecure\("deleteElectionSchedule"/);
  assert.match(js, /openScheduleEditor\("create"\)/);
});

test("schedule editing follows Election module assignment instead of a separate admin-granted schedule permission", () => {
  assert.doesNotMatch(permissions, /key: "elections\.schedule"/);
  assert.match(security, /browserSaveElectionSchedule[\s\S]*?requireBrowserPermission\("elections\.view"\)/);
  assert.doesNotMatch(security, /Normal schedule editing is locked once candidate registration begins/);
  assert.match(functions, /exports\.saveElectionSchedule[\s\S]*?requireOfficerPermission\(request, "elections\.view"\)/);
  assert.match(rules, /match \/election_config\/\{docId\}[\s\S]*?allow create, update: if officerHasPermission\("elections\.view"\)/);
  assert.match(rules, /allow delete: if officerHasPermission\("elections\.view"\) && docId == "current"/);
});

test("secure lifecycle and turnout snapshot sit below candidate application review", () => {
  const review = html.indexOf('id="candidateReviewCard"');
  const lifecycle = html.indexOf('id="secureElectionLifecycle"');
  const turnout = html.indexOf('class="card turnout-result-card"');
  assert.ok(review >= 0 && lifecycle > review && turnout > review);
});
