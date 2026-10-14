import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const provisioning = fs.readFileSync(new URL("../shared/browser-provisioning.js", import.meta.url), "utf8");
const officerRegistration = fs.readFileSync(new URL("../usc-admin/student-registration/js/officer-registration.js", import.meta.url), "utf8");
const studentRegistration = fs.readFileSync(new URL("../usc-admin/student-registration/js/student-registration.js", import.meta.url), "utf8");
const officerHtml = fs.readFileSync(new URL("../usc-admin/student-registration/officer-registration.html", import.meta.url), "utf8");
const studentHtml = fs.readFileSync(new URL("../usc-admin/student-registration/student-registration.html", import.meta.url), "utf8");

function functionBody(source, functionName) {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("officer provisioning imports and applies the USC position permission preset", () => {
  assert.match(
    provisioning,
    /import\s*\{\s*permissionsForOfficerPosition\s*\}\s*from\s*["']\.\/officer-permissions\.js["'];/,
    "browser-provisioning must import the position preset resolver"
  );
  const officerBody = functionBody(provisioning, "provisionOfficerAccount");
  assert.match(officerBody, /const positionPermissions = permissionsForOfficerPosition\(officePosition\)/);
  assert.match(officerBody, /officerPermissions:\s*positionPermissions/);
  assert.match(officerBody, /officerPermissionSource:\s*["']position-default["']/);
});

test("student provisioning remains independent of officer-only RBAC defaults", () => {
  const studentBody = functionBody(provisioning, "provisionStudentAccount");
  assert.doesNotMatch(studentBody, /DEFAULT_OFFICER_PERMISSIONS|officerPermissions/);
  assert.match(studentBody, /role:\s*["']student["']/);
});

test("registration pages cache-bust the corrected provisioning module", () => {
  assert.match(officerRegistration, /browser-provisioning\.js\?v=3/);
  assert.match(studentRegistration, /browser-provisioning\.js\?v=3/);
  assert.match(officerHtml, /officer-registration\.js\?v=\d+/);
  assert.match(studentHtml, /student-registration\.js\?v=\d+/);
});
