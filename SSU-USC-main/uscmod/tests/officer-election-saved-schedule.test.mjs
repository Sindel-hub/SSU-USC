import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const security = read("shared/security-client.js");
const functions = read("functions/index.js");
const rules = read("firestore.rules");
const permissions = read("shared/officer-permissions.js");

test("schedule editing follows Election module assignment instead of a separate admin-granted schedule permission", () => {
  assert.doesNotMatch(permissions, /key: "elections\.schedule"/);
  assert.match(security, /browserSaveElectionSchedule[\s\S]*?requireBrowserPermission\("elections\.view"\)/);
  assert.doesNotMatch(security, /Normal schedule editing is locked once candidate registration begins/);
  assert.match(functions, /exports\.saveElectionSchedule[\s\S]*?requireOfficerPermission\(request, "elections\.view"\)/);
  assert.match(rules, /match \/election_config\/\{docId\}[\s\S]*?allow create, update: if officerHasPermission\("elections\.view"\)/);
  assert.match(rules, /allow delete: if officerHasPermission\("elections\.view"\) && docId == "current"/);
});
