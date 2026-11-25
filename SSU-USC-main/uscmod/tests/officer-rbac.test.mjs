import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("RBAC defines module and function permissions for USC officers", () => {
  const permissions = read("shared/officer-permissions.js");
  for (const key of [
    "dashboard.view",
    "elections.view",
    "elections.review",
    "elections.results",
    "complaints.view",
    "complaints.review",
    "complaints.classify",
    "complaints.feedback",
    "complaints.status",
    "bulletin.manage",
    "events.manage",
    "organization.view"
  ]) assert.match(permissions, new RegExp(key.replaceAll(".", "\\.")));
  assert.match(permissions, /DEFAULT_OFFICER_PERMISSIONS/);
  assert.match(permissions, /OFFICER_POSITION_PERMISSION_PRESETS/);
  assert.match(permissions, /permissionsForOfficerPosition/);
  assert.match(permissions, /legacyFullAccess/);
});

test("officer modules are universally viewable after authentication while RBAC controls actions", () => {
  const guard = read("shared/auth-guard.js");
  const rbac = read("usc-admin/shared/js/officer-rbac.js");
  assert.doesNotMatch(guard, /redirectOfficerForRbac|officerModuleAllowed|permissionForOfficerPath/);
  assert.match(rbac, /permissionForOfficerPath/);
  assert.doesNotMatch(rbac, /renderModuleReadOnlyBanner|officer-module-readonly-banner/);
  assert.match(rbac, /rbac-readonly-link/);
  for (const page of ["overview", "announcements", "events", "programs", "organizational-chart", "complaints"]) {
    const html = read(`usc-admin/${page}/${page}.html`);
    assert.match(html, /officer-rbac\.js/);
  }
});

test("officer permission management is centralized in Officer Management", () => {
  const html = read("usc-admin/admin-dashboard/users.html");
  const js = read("usc-admin/admin-dashboard/js/admin-users.js");
  const management = read("usc-admin/admin-dashboard/officer-management.html");
  assert.match(html, /officerPermissionGrid/);
  assert.doesNotMatch(html, /Apply to same office|Full officer access/);
  assert.doesNotMatch(js, /function syncLegacyPositionPresets|const sameOffice/);
  assert.match(js, /input.disabled = true/);
  assert.match(management, /id="assignmentPermissions"/);
  assert.match(management, /id="termEnd"/);
});

test("separate officer creation directs administrators to existing-account promotion", () => {
  const provisioning = read("shared/browser-provisioning.js");
  assert.match(provisioning, /Use Officer Management to promote an existing approved student account/);
  const management = read("server/officer-history.cjs");
  assert.match(management, /officerPermissions/);
  assert.match(management, /officerPermissionSource: "custom"/);
});

test("complaint and election actions enforce function-level permissions", () => {
  const security = read("shared/security-client.js");
  for (const permission of [
    "complaints.review",
    "complaints.classify",
    "complaints.feedback",
    "complaints.status",
    "elections.roster",
    "elections.review",
    "elections.results"
  ]) assert.match(security, new RegExp(permission.replaceAll(".", "\\.")));

  const complaintHtml = read("usc-admin/complaints/complaints.html");
  assert.match(complaintHtml, /data-rbac-permission="complaints\.status"/);
  assert.match(complaintHtml, /data-rbac-permission="complaints\.classify"/);
  assert.match(complaintHtml, /data-rbac-permission="complaints\.feedback"/);

});


test("officer dashboard keeps complaint analytics and recent records without election access visible in the read-only model", () => {
  const html = read("usc-admin/overview/overview.html");
  const js = read("usc-admin/overview/js/overview.js");
  assert.match(html, /data-summary="complaint"/);
  assert.doesNotMatch(html, /href="\.\.\/elections\/elections\.html"/);
  assert.match(html, /id="officerOverviewEvents"/);
  assert.match(html, /id="officerOverviewPrograms"/);
  assert.match(js, /renderOverviewChart\('complaint'/);
  assert.match(js, /state\.complaintAnalytics =/);
  assert.doesNotMatch(js, /overviewHasPermission\("complaints\.view"\)/);
  assert.doesNotMatch(js, /Aggregate complaint statistics are available on the dashboard/);
  assert.match(js, /where\("classification","==","Student Level"\)/);
  assert.match(js, /orderBy\("createdAt","desc"\), limit\(4\)/);
});

test("Firestore rules enforce officer permissions on privileged writes", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /function officeDefaultHasPermission\(permission\)/);
  assert.match(rules, /return officerHasPermission\(permission\)/);
  assert.match(rules, /!\("officerAssignmentId" in ownProfile\(\)\)/);
  assert.match(rules, /function officerHasPermission\(permission\)/);
  assert.match(rules, /ownProfile\(\)\.officePosition == "Secretary"/);
  assert.match(rules, /match \/announcements\/[^\n]+[\s\S]*?allow delete: if isAdmin\(\)/);
  assert.match(rules, /match \/events\/[^\n]+[\s\S]*?allow create, update, delete: if isAdmin\(\)/);
  assert.match(rules, /match \/complaints\/[^\n]+[\s\S]*?allow update: if isAdmin\(\)/);
  assert.match(rules, /officerHasPermission\("complaints\.status"\)/);
  assert.match(rules, /officerHasPermission\("complaints\.classify"\)/);
  assert.match(rules, /officerHasPermission\("elections\.view"\)/);
  assert.match(rules, /officerHasPermission\("elections\.roster"\)/);
  assert.match(rules, /officerHasPermission\("elections\.review"\)/);
  assert.match(rules, /officerHasPermission\("elections\.results"\)/);
});
