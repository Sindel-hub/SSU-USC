import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("officer route guard no longer redirects unassigned modules", () => {
  const guard = read("shared/auth-guard.js");
  assert.doesNotMatch(guard, /officerModuleAllowed|redirectOfficerForRbac|OFFICER_OVERVIEW_URL/);
  assert.match(guard, /if \(path\.includes\("\/usc-admin\/"\)\) return \["officer", "admin"\]/);
});

test("unassigned module navigation remains clickable and becomes read-only", () => {
  const rbac = read("usc-admin/shared/js/officer-rbac.js");
  assert.match(rbac, /anchor\.classList\.add\("rbac-readonly-link"\)/);
  assert.match(rbac, /Read-only access:/);
  assert.doesNotMatch(rbac, /alert\(`Access restricted[\s\S]*?anchor/);
});

test("Bulletin Board and Events expose viewing but disable management for unassigned offices", () => {
  const announcementsHtml = read("usc-admin/announcements/announcements.html");
  const announcementsJs = read("usc-admin/announcements/js/announcements.js");
  const eventsHtml = read("usc-admin/events/events.html");
  const eventsJs = read("usc-admin/events/js/events.js");

  assert.match(announcementsHtml, /id="announcementForm" data-rbac-permission="bulletin\.manage"/);
  assert.match(announcementsHtml, /id="scrollToFormBtn"[^>]*data-rbac-permission="bulletin\.manage"/);
  assert.match(announcementsJs, /data-delete-announcement=.*data-rbac-permission="bulletin\.manage"/);

  assert.match(eventsHtml, /id="eventForm" data-rbac-permission="events\.manage"/);
  assert.match(eventsHtml, /id="scrollToEventFormBtn"[^>]*data-rbac-permission="events\.manage"/);
  assert.match(eventsJs, /data-delete-event=.*data-rbac-permission="events\.manage"/);
});

test("Election and Complaint action controls remain permission-scoped", () => {
  const electionHtml = read("usc-admin/elections/elections.html");
  const electionJs = read("usc-admin/elections/js/elections.js");
  const complaintHtml = read("usc-admin/complaints/complaints.html");

  assert.match(electionHtml, /data-rbac-permission="elections\.view"/);
  assert.match(electionHtml, /data-rbac-permission="elections\.review"/);
  assert.match(electionHtml, /data-rbac-permission="elections\.results"/);
  assert.match(electionHtml, /id="finalizeElectionBtn"[^>]*data-rbac-permission="elections\.results"/);
  assert.match(electionHtml, /id="publishResultsBtn"[^>]*data-rbac-permission="elections\.results"/);

  assert.match(complaintHtml, /data-rbac-permission="complaints\.review"/);
  assert.match(complaintHtml, /data-rbac-permission="complaints\.classify"/);
  assert.match(complaintHtml, /data-rbac-permission="complaints\.feedback"/);
  assert.match(complaintHtml, /data-rbac-permission="complaints\.status"/);
});

test("Firestore permits officer reads needed for read-only complaint/election modules while preserving write permissions", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /allow list: if signedIn\(\) && \(resource\.data\.studentUid == uid\(\) \|\| isOfficerOrAdmin\(\)\);/);
  assert.match(rules, /match \/applications\/\{applicantUid\}[\s\S]*?allow read: if ownUser\(applicantUid\) \|\| isOfficerOrAdmin\(\);/);
  assert.match(rules, /match \/candidates\/\{candidateId\}[\s\S]*?allow read: if isOfficerOrAdmin\(\)/);
  assert.match(rules, /allow create, update, delete: if officerHasPermission\("bulletin\.manage"\);/);
  assert.match(rules, /allow create, update, delete: if officerHasPermission\("events\.manage"\);/);
  assert.match(rules, /allow update: if officerHasPermission\("complaints\.review"\)/);
  assert.match(rules, /allow create: if officerHasPermission\("elections\.view"\)/);
});

test("System Administrator RBAC editor explains read-only behavior", () => {
  const html = read("usc-admin/admin-dashboard/users.html");
  assert.match(html, /Unassigned officer modules remain visible in read-only mode/);
  assert.match(html, />Read-only portal<\/button>/);
  assert.match(html, /Other modules remain read-only/);
});
