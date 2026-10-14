import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OFFICER_PERMISSIONS,
  effectiveOfficerPermissions,
  permissionsForOfficerPosition
} from "../shared/officer-permissions.js";

function has(position, permission) {
  return permissionsForOfficerPosition(position).includes(permission);
}

test("President is the default Complaint manager while Elections are read-only", () => {
  for (const permission of [
    "dashboard.view",
    "complaints.view",
    "complaints.review",
    "complaints.classify",
    "complaints.feedback",
    "complaints.status",
    "complaints.report",
    "bulletin.manage",
    "events.manage",
    "organization.view",
    "reports.generate"
  ]) {
    assert.equal(has("President", permission), true, `President should receive ${permission}`);
  }

  for (const permission of [
    "elections.view",
    "elections.roster",
    "elections.review",
    "elections.results"
  ]) {
    assert.equal(has("President", permission), false, `President should not receive ${permission} by default`);
  }
});

test("Vice President is the default Election manager while Complaints are read-only", () => {
  for (const permission of [
    "dashboard.view",
    "elections.view",
    "elections.roster",
    "elections.review",
    "elections.results",
    "bulletin.manage",
    "events.manage",
    "organization.view",
    "reports.generate"
  ]) {
    assert.equal(has("Vice President", permission), true, `Vice President should receive ${permission}`);
  }

  for (const permission of [
    "complaints.view",
    "complaints.review",
    "complaints.classify",
    "complaints.feedback",
    "complaints.status",
    "complaints.report"
  ]) {
    assert.equal(has("Vice President", permission), false, `Vice President should not receive ${permission} by default`);
  }
});

test("Secretary receives the documented Bulletin Board and Events access", () => {
  for (const permission of ["dashboard.view", "bulletin.manage", "events.manage", "organization.view", "reports.generate"]) {
    assert.equal(has("Secretary", permission), true, `Secretary should receive ${permission}`);
  }
  for (const permission of ["elections.view", "complaints.view"]) {
    assert.equal(has("Secretary", permission), false, `Secretary should not receive ${permission} by default`);
  }
});

test("remaining USC positions receive the intended default module scope", () => {
  for (const position of ["Treasurer", "Auditor"]) {
    assert.equal(has(position, "reports.generate"), true);
    assert.equal(has(position, "organization.view"), true);
    assert.equal(has(position, "bulletin.manage"), false);
    assert.equal(has(position, "elections.view"), false);
  }

  for (const position of ["Public Relations Officer (PRO)"]) {
    assert.equal(has(position, "bulletin.manage"), true);
    assert.equal(has(position, "events.manage"), true);
    assert.equal(has(position, "organization.view"), true);
    assert.equal(has(position, "complaints.view"), false);
  }

  assert.equal(has("Business Manager", "events.manage"), true);
  assert.equal(has("Business Manager", "reports.generate"), true);
  assert.equal(has("Business Manager", "bulletin.manage"), false);

  assert.equal(has("Sgt. at Arms", "events.manage"), true);
  assert.equal(has("Sgt. at Arms", "organization.view"), true);
  assert.equal(has("Sgt. at Arms", "complaints.view"), false);

  assert.equal(has("Department Representative", "complaints.view"), true);
  assert.equal(has("Department Representative", "complaints.review"), true);
  assert.equal(has("Department Representative", "complaints.classify"), false);
  assert.equal(has("Department Representative", "complaints.feedback"), false);
  assert.equal(has("Department Representative", "complaints.status"), false);
});

test("first RBAC revision baseline accounts are repaired from their office position", () => {
  const permissions = effectiveOfficerPermissions({
    role: "officer",
    officePosition: "Secretary",
    officerPermissions: [...DEFAULT_OFFICER_PERMISSIONS]
  });
  assert.equal(permissions.includes("bulletin.manage"), true);
  assert.equal(permissions.includes("events.manage"), true);
});

test("an explicit custom permission set overrides position defaults", () => {
  const permissions = effectiveOfficerPermissions({
    role: "officer",
    officePosition: "Secretary",
    officerPermissionSource: "custom",
    officerPermissions: [...DEFAULT_OFFICER_PERMISSIONS]
  });
  assert.equal(permissions.includes("bulletin.manage"), false);
  assert.deepEqual(new Set(permissions), new Set(DEFAULT_OFFICER_PERMISSIONS));
});
