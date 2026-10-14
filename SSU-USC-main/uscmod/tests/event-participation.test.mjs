import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studentHtml = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const studentJs = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");
const studentCss = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const adminHtml = fs.readFileSync(new URL("../usc-admin/events/events.html", import.meta.url), "utf8");
const adminJs = fs.readFileSync(new URL("../usc-admin/events/js/events.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("officers can choose portal, external, or no-registration participation", () => {
  assert.match(adminHtml, /id="eventRegistrationMode"/);
  assert.match(adminHtml, /value="internal">Register inside USC Portal/);
  assert.match(adminHtml, /value="external">External registration link/);
  assert.match(adminHtml, /value="none">No registration required/);
  assert.match(adminHtml, /id="eventRegistrationDeadline"/);
  assert.match(adminHtml, /id="eventExternalRegistrationUrl"/);
  assert.match(adminHtml, /id="eventParticipationNotes"/);
  assert.match(adminJs, /registrationDeadline = Timestamp\.fromDate\(deadlineDate\)/);
  assert.match(adminJs, /externalRegistrationUrl: registrationMode === "external"/);
});

test("student Events contains a real participation flow instead of display-only cards", () => {
  assert.match(studentHtml, /id="eventsHighlightAction"/);
  assert.match(studentHtml, /id="eventsDetailModal"/);
  assert.match(studentHtml, /id="eventsRegistrationState"/);
  assert.match(studentJs, /data-register-event/);
  assert.match(studentJs, /setDoc\(registrationRef/);
  assert.match(studentJs, /data-cancel-registration/);
  assert.match(studentJs, /deleteDoc\(registrationRef\)/);
  assert.match(studentJs, /Open registration form/);
  assert.match(studentCss, /STUDENT EVENT PARTICIPATION MODULE - 2026-09-07/);
});

test("portal registration stores only the signed-in student's participation record", () => {
  assert.match(rules, /match \/events\/\{eventId\}/);
  assert.match(rules, /match \/registrations\/\{userId\}/);
  assert.match(rules, /ownUser\(userId\)/);
  assert.match(rules, /registrationMode == "internal"/);
  assert.match(rules, /request\.time < get\([\s\S]*?\)\.data\.registrationDeadline/);
  assert.match(rules, /request\.resource\.data\.studentId == ownProfile\(\)\.studentId/);
  assert.match(rules, /request\.resource\.data\.status == "registered"/);
});

test("officer Events can inspect website registrations", () => {
  assert.match(adminHtml, /id="eventParticipantsModal"/);
  assert.match(adminJs, /collection\(db, "events", eventId, "registrations"\)/);
  assert.match(adminJs, /data-view-participants/);
  assert.match(adminJs, /getDocs\(collection\(db, "events", eventId, "registrations"\)\)/);
});
