# Event participation management — review and staging handoff

Branch: `feature/event-participation-management`, based on `e15b04d`.

Status: implemented locally. Security-rule tests now pass; authenticated staging acceptance remains pending. No GitHub push, PR, Vercel deployment, production configuration change, or production database write has been performed for this feature. Screenshots use fictional students and are not a live Preview.

## Behavior

- Officers create/edit internal-registration events and programs with six separate registration/time-in/time-out schedule boundaries, in Manila time. Target departments, programs, years and sections can be selected together, or all students included. Department/program options reuse the official existing program list; year/section options come from actual student profiles, in pages. Missing academic fields are not fabricated.
- Public event visibility remains available through the existing public pages. Student eligibility and registration are checked on the server. Registering does not record attendance. Duplicate concurrent registration requests return the same UID-based registration.
- My QR Code is available from the student dashboard, Events/Programs, and Tracklist navigation. A permanent opaque QR identifier is assigned automatically on dashboard/My QR first use, including existing accounts. It is also available for SVG download or expansion. The QR contains no student ID or profile data; current academic details are loaded separately. No account recreation or bulk backfill is needed.
- Manage Attendance opens an event-specific modal with counters, participant search/status filtering, and Participants/Scan attendance controls. Authorized officers select a scanning mode and camera, scan the QR, compare the displayed profile with the physical school ID, then explicitly confirm. Scanning alone does not record attendance.
- Trusted server time, transactions, UID ownership, active-account checks, current permissions, registration, eligibility and schedule checks protect attendance. Each event/student has at most one time-in and one time-out. Confirmation retries return the original result without another audit entry. A saved attendance result is shown only after the API succeeds.
- Completed duration is time-out minus time-in. Absent/Incomplete are derived when the configured monitoring closes; there is no client-written finalization job. Legacy registrations that predate monitoring are not retrospectively marked absent. Eligible students without registration remain Not Registered and receive no fabricated database record.
- Student Participation Tracklist provides a student directory and a registration/attendance view, academic filters, event/title/date/status filters, and a View Record history modal. Student history is also available from the existing student Tracklist. Historical academic snapshots and original UIDs remain separate from current profiles and reused visible Student IDs.
- Read-only officers do not receive the new attendance/tracklist management controls. Backend endpoints independently enforce the existing module permissions. No correction endpoint or direct browser attendance writes are exposed.

## Before / after

Previously student registration wrote directly to Firestore; registration and published metadata were the available participation information. Registration could point at an external form. There was no permanent student QR, officer identity-confirmation scan, time-in/out, duration, or shared participation history.

New student registration calls `participationRegister` through the existing authenticated management API. Officer publication requires internal schedules. Attendance uses a separate lookup → physical-ID confirmation → atomic record flow. Existing registrations are retained; historical UID ownership is preserved.

## Database and rules

Existing paths are extended rather than replaced:

| Path | Purpose |
| --- | --- |
| `events/{id}` / `programs/{id}` | Six schedule boundaries, `targetParticipants`, participation version and schedule-lock marker. No private attendee data is stored on public event documents. |
| `{source}/{eventId}/registrations/{studentUid}` | One registration/attendance record per immutable Firebase UID. Includes registration time, academic/event snapshot, monitoring closing boundary, official in/out times, recording officer UIDs and completed duration. |
| `{source}/{eventId}/attendance_audit/{id}` | Private append-only server-created attendance entries with event, student UID, officer UID, mode and server time. |
| `student_qr/{studentUid}` | Private permanent random QR token and owning UID. |
| `student_qr_tokens/{sha256(token)}` | Private reverse lookup. |
| `attendance_confirmations/{sha256(confirmation)}` | Private officer/event/student/mode binding, two-minute validity, and an idempotent saved result after use. |

The existing `registrations.studentUid` collection-group ascending index in `firestore.indexes.json` supports individual history. Confirm it is enabled in staging. No new index definitions or automatic production migration are introduced. New registrations include immutable academic snapshots; old records use their existing saved academic fields. Attendance confirmation documents remain private after expiry and cannot authorize new attendance; a retention/TTL policy can be considered separately rather than silently changing infrastructure retention.

The local rules draft denies browser writes to event/program registrations. Existing authorized registration reads remain available. QR mappings and confirmation documents are private; attendance-audit subcollections inherit default denial. All new writes use the authenticated server and are revalidated there. Public event/program reads are preserved as explicitly requested. No unrelated rules are redesigned.

Rules review considered public/private access, direct create/update/delete bypass, forged UID/ownership, arbitrary fields, timestamp forgery, privilege changes, record replay and orphaned private paths. Direct participation writes are denied, while trusted API behavior is covered by authorization/concurrency tests. The six Firestore emulator tests now pass, including public visibility and private identity/write protections. Authenticated staging acceptance is still required.

## Verification

- Focused automated tests: 84 passing (attendance/model, publication/history regression, existing event/program contracts, authenticated HTTP routing, runtime startup and JavaScript syntax).
- Broader regression run: 122 passing across officer history, portal data, RBAC, student records and navigation/profile checks. These overlap some focused tests and should not be summed as a unique test count.
- Playwright: actual pages and actual authenticated HTTP handlers, backed by a synthetic database/Auth fixture. QR persistence, expansion/download, registration through the normal button, high-resolution QR decoding, explicit confirmation, time-in/out, history, combined tracklist filters, camera denial, publishing/editing, and desktop/tablet/mobile layouts pass without page errors. Hardware cameras and real Firebase have not been used in this run.
- Local hosted build prepared successfully against the public staging configuration; no service-account credentials are embedded in static output.
- `git diff --check`: passes.
- Full `npm test`: stops at nine existing account-removal/Gmail-login failures. The same nine failures were reproduced on unchanged base `e15b04d`; they are unrelated to this enhancement. Legitimate assertions were not disabled to make this feature pass.
- Firestore rule tests: six passing after the user published the storage.googleapis.com grant and it was applied to this running task. The official emulator downloaded and the tests completed successfully against a local demo database. No remote Firebase rules were published.

Repeatable commands:

```sh
npm ci
npm run test:event-participation
npm run test:syntax
npm run test:hosted-management
npm run test:officer-history
npm run test:portal-data
npm run test:rbac
npm run test:student-records
npm run test:navigation-profile
npm run test:event-attendance-browser
npm run test:event-participation-rules
```

The browser script requires Playwright and Chromium. This Cloud workspace uses its installed Playwright module and `/usr/bin/chromium`. Rule tests use the local Firestore emulator, not production. On this Cloud machine use a temporary emulator config on an unreserved port (8086), because the repository's existing default 8080 is reserved for Cloud services.

## Remaining limits and staging steps

1. Completed: the approved emulator-download grant is active and all six local rules tests pass.
2. Establish an authorized staging Firebase CLI/Console session, apply the reviewed rules to **ssu-usc-email-staging only**, and verify the existing collection-group index. No staging Firebase publishing identity is configured in the available runtime. Do not send private service-account JSON in chat.
3. Configure the feature branch Preview to use the isolated staging project, its existing staging server credential and matching public web config. The existing hosted build blocks production Firebase/Supabase use in staging. Test with synthetic officer/student accounts and staging records; no production student data.
4. Deploy the branch to Vercel Preview, verify its exact commit and successful build, then test the real Firebase/camera flow there. Provide the actual verified URL. A Preview has **not** yet been created.
5. Obtain the user's Preview approval before preparing the PR, following the attached request. The user performs the final merge manually. Production backend/rule changes still need separate explicit approval.

Filtering and counts in paginated tables explicitly apply to loaded records; Load more includes the next page without a full-database realtime listener. Individual history loads registration history first, followed by current eligible unregistered events/programs. Its eligible summary combines preserved registered history with current-profile eligibility, rather than inventing historical eligibility for unregistered students. Use the event-specific roster to review Not Registered students. Real mobile camera focus, rear-camera selection and physical-ID checks still require device acceptance testing. Complete staging rule/API checks before presenting the feature as ready to deploy.

For any eventual production cutover, coordinate the frontend/API release and the reviewed rules: old open browser tabs used direct registration writes and may need a refresh after the new rules are published. Keep an approved prior deployment available. Do not delete registrations, QR mappings or audits during rollback, and do not reopen direct attendance writes to work around an issue.

## Modified files

- `dashboard/dashboard.html`
- `dashboard/events.html`
- `dashboard/js/events.js`
- `dashboard/tracklist.html`
- `firestore.rules`
- `package.json`
- `server/http.cjs`
- `server/officer-modules.cjs`
- `server/runtime.cjs`
- `tests/event-participation.rules.test.mjs`
- `tests/event-participation.test.mjs`
- `tests/hosted-management.test.mjs`
- `tests/officer-history.test.mjs`
- `tests/programs-module.test.mjs`
- `usc-admin/events/events.html`
- `usc-admin/events/js/events.js`
- `usc-admin/programs/js/programs.js`
- `usc-admin/programs/programs.html`
- `dashboard/my-qr.html`
- `docs/EVENT-PARTICIPATION.md`
- `server/event-participation.cjs`
- `shared/event-participation-model.mjs`
- `shared/participation-form.js`
- `shared/participation-history.js`
- `shared/participation-officer.js`
- `shared/participation-student.js`
- `shared/participation-tracklist.js`
- `shared/participation.css`
- `tests/browser/event-participation.cjs`
- `tests/event-attendance.test.mjs`
- `tests/helpers/participation-fixture.cjs`
- `vendor/qr/jsQR-LICENSE`
- `vendor/qr/jsQR.js`
- `vendor/qr/qrcode-README.md`
- `vendor/qr/qrcode.js`
