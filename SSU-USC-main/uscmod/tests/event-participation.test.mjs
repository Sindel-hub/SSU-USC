import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studentHtml = fs.readFileSync(new URL("../dashboard/events.html", import.meta.url), "utf8");
const studentJs = fs.readFileSync(new URL("../dashboard/js/events.js", import.meta.url), "utf8");
const studentCss = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const adminHtml = fs.readFileSync(new URL("../usc-admin/events/events.html", import.meta.url), "utf8");
const adminJs = fs.readFileSync(new URL("../usc-admin/events/js/events.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("officers publish internal participation with registration and attendance schedules", () => {
  assert.match(adminHtml, /id="eventRegistrationMode"/);
  assert.match(adminHtml, /value="internal">Register inside USC Portal/);
  assert.doesNotMatch(adminHtml, /value="external"/);
  assert.doesNotMatch(adminHtml, /value="none"/);
  assert.match(adminHtml, /id="eventRegistrationDeadline"/);
  assert.match(adminHtml, /id="eventExternalRegistrationUrl"/);
  assert.match(adminHtml, /id="eventParticipationNotes"/);
  assert.match(adminJs, /registrationDeadline = Timestamp\.fromDate\(/);
  assert.match(adminJs, /participationForm.read\(\)/);
});

test("student Events contains a real participation flow instead of display-only cards", () => {
  assert.match(studentHtml, /id="eventsHighlightAction"/);
  assert.match(studentHtml, /id="eventsDetailModal"/);
  assert.match(studentHtml, /id="eventsRegistrationState"/);
  assert.match(studentJs, /data-register-event/);
  assert.match(studentJs, /hostedManagementCall\('participationRegister'/);
  assert.match(studentJs, /eventRegistrationState/);
  assert.doesNotMatch(studentJs, /deleteDoc\(registrationRef\)/);
  assert.doesNotMatch(studentJs, /Open registration form/);
  assert.match(studentCss, /STUDENT EVENT PARTICIPATION MODULE - 2026-09-07/);
});

test("portal registration stores only the signed-in student's participation record", () => {
  assert.match(rules, /match \/events\/\{eventId\}/);
  assert.match(rules, /match \/registrations\/\{userId\}/);
  assert.match(rules, /ownUser\(userId\)/);
  assert.match(rules, /allow create, update, delete: if false/);
  const backend = fs.readFileSync(new URL('../server/event-participation.cjs',import.meta.url),'utf8');
  assert.match(backend, /activeStudent\(profile\)/);
  assert.match(backend, /registrationState\(\s*event,\s*capturedAcademic\s*\|\|\s*profile,\s*null,\s*now\s*,?\s*\)/);

});

test("officer Events can inspect website registrations", () => {
  assert.match(adminHtml, /id="eventParticipantsModal"/);
  assert.match(adminJs, /collection\(db, "events", eventId, "registrations"\)/);
  assert.match(adminJs, /data-view-participants/);
  assert.match(adminJs, /getDocs\(collection\(db, "events", eventId, "registrations"\)\)/);
});
