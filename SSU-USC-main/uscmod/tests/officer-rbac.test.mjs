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
  for (const page of ["overview", "announcements", "elections", "events", "organizational-chart", "complaints"]) {
    const html = read(`usc-admin/${page}/${page}.html`);
    assert.match(html, /officer-rbac\.js/);
  }
});

test("System Administrator can configure per-officer permissions and copy them by office", () => {
  const html = read("usc-admin/admin-dashboard/users.html");
  const js = read("usc-admin/admin-dashboard/js/admin-users.js");
  const core = read("usc-admin/admin-dashboard/js/admin-core.js");
  assert.match(html, /Officer role-based access/);
  assert.match(html, /officerPermissionGrid/);
  assert.match(html, /Apply to same office/);
  assert.match(js, /selectedOfficerPermissions/);
  assert.match(js, /sameOffice/);
  assert.match(js, /officerPermissions:/);
  assert.match(core, /nextOfficerPermissions/);
  assert.match(core, /officer permissions updated/);
});

test("new officer accounts receive the permission preset for their USC position", () => {
  const provisioning = read("shared/browser-provisioning.js");
  assert.match(provisioning, /permissionsForOfficerPosition/);
  assert.match(provisioning, /const positionPermissions = permissionsForOfficerPosition\(officePosition\)/);
  assert.match(provisioning, /officerPermissions:\s*positionPermissions/);
  assert.match(provisioning, /officerPermissionSource:\s*["']position-default["']/);
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

  const electionHtml = read("usc-admin/elections/elections.html");
  assert.match(electionHtml, /data-rbac-permission="elections\.view"/);
  assert.match(electionHtml, /data-rbac-permission="elections\.review"/);
  assert.match(electionHtml, /data-rbac-permission="elections\.results"/);
});


test("officer dashboard keeps complaint/election summaries and recent records visible in the read-only model", () => {
  const html = read("usc-admin/overview/overview.html");
  const js = read("usc-admin/overview/js/overview.js");
  assert.match(html, /data-overview-total-complaints/);
  assert.match(html, /data-overview-complaint-student/);
  assert.match(html, /data-overview-complaint-administrative/);
  assert.match(html, /data-overview-complaint-crisis/);
  assert.match(html, /data-overview-election-registered/);
  assert.doesNotMatch(js, /overviewHasPermission\("complaints\.view"\)/);
  assert.doesNotMatch(js, /Aggregate complaint statistics are available on the dashboard/);
  assert.match(js, /where\("classification","==","Student Level"\)/);
  assert.match(js, /orderBy\("createdAt","desc"\), limit\(4\)/);
});

test("Firestore rules enforce officer permissions on privileged writes", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /function officeDefaultHasPermission\(permission\)/);
  assert.match(rules, /function officerHasPermission\(permission\)/);
  assert.match(rules, /ownProfile\(\)\.officePosition == "Secretary"/);
  assert.match(rules, /officerHasPermission\("bulletin\.manage"\)/);
  assert.match(rules, /officerHasPermission\("events\.manage"\)/);
  assert.match(rules, /officerHasPermission\("complaints\.review"\)/);
  assert.match(rules, /officerHasPermission\("complaints\.status"\)/);
  assert.match(rules, /officerHasPermission\("complaints\.classify"\)/);
  assert.match(rules, /officerHasPermission\("elections\.view"\)/);
  assert.match(rules, /officerHasPermission\("elections\.roster"\)/);
  assert.match(rules, /officerHasPermission\("elections\.review"\)/);
  assert.match(rules, /officerHasPermission\("elections\.results"\)/);
});
