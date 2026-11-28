# Reporting and Analytics

Development branch: `feature/reporting-and-analytics`. Production is unchanged.

## Implemented behavior

The officer portal gains Reporting & Analytics in its existing sidebar and module search. The page reuses the shared dashboard shell and adds Events and Participation, Complaints and Feedback, and Student Council Activities tabs.

- Participation drills through department, program, year and section to a student attendance modal. Filters, breadcrumbs and pagination share one calculated dataset. Student history reuses the existing authorized Tracklist endpoint.
- The source of attendance status remains the existing participation model. Actual attendance requires time-in, registrations are not attendance, and absent/incomplete percentages stay pending until the selected windows close. Multi-event totals use student-event opportunities and also show distinct attendees.
- New publications prepare an eligible student cohort in resumable transactions of at most 100 student profiles. Only UID, student ID, name and academic classifications are retained in private chunks. The manifest records capture start/end times: preparation is an interval, not an invented historical point-in-time reconstruction. Registration waits for completion. Existing events without a captured cohort keep their original registration behavior and have N/A eligible counts/rates.
- The cohort is immutable after registrations begin. Profile changes, deactivation and reused visible student IDs do not move historical attendance to a different UID or academic group. A changed pre-registration target starts a new capture. Incomplete/corrupt snapshots fail visibly instead of silently dropping registered students.
- Complaints use the existing five statuses. Closed only counts as resolved when a resolved outcome was recorded. New status transitions preserve resolution timestamps in the hosted officer handler and compatible administrator paths. Older undated resolutions have N/A durations. Analytics and exports exclude student identities, descriptions, feedback threads and attachments.
- Complaint View Record opens the existing complaint management interface, using its existing permissions, rather than a new case manager.
- Activities combine actual officer metadata, attendance audit entries and report-export audit receipts. Ordinary reporting officers see their own audit activity; President/administrator scope follows existing authorization. Unsupported historical actions are never invented. An elapsed schedule alone is not evidence an event was conducted.
- Excel downloads are genuine XLSX workbooks. Attendance contains Attendance Summary, Academic Breakdown and, when authorized, Individual Attendance Records. Complaint workbooks include summary/department data and authorized case metadata. Activity workbooks include source event/participation summaries, completion trends and authorized audit records. Dates and durations use Excel numeric values, percentages use numeric fractions, IDs remain text, and user strings are literal cells. Headers, filters, freeze panes, alternate fills and attendance status formatting are included.

## Access and database changes

No permission grants, authentication changes, Firebase rules edits, production configuration changes or new package dependencies are introduced. Server reporting requires `reports.generate`. Attendance identities require the respective `events.manage` or `programs.manage` permission. Complaint details require `complaints.review`; complaint export requires `complaints.report`. Aggregate access does not return student identities or case subjects/references. Export audit transactions recheck permissions and bind an operation ID to its report parameters.

New private server-only collections:

- `reporting_eligibility/{snapshotId}` and `chunks/{page}`: immutable eligible academic cohort and preparation cursor.
- `reporting_audit/{officerUid}_{operationId}`: idempotent export authorization receipt. This records authorization, not a claim that the browser finished saving a file.

New source metadata: eligibility policy/snapshot/state on events and programs; optional academic year/semester; `reportUpdatedAtMs` on new registrations and attendance changes; verified resolution outcome/timestamp on new complaint status transitions. Existing officer audit records remain the complaint status history; no synthetic backfill is run.

The existing default-deny rules protect both new collections; browser reads/writes are tested as denied. No rules deployment is needed for these paths. `firestore.indexes.json` adds bounded own-officer activity/time indexes and attendance-audit collection-group indexes. Publish these **only to `ssu-usc-email-staging` for Preview testing**. Production index/rule changes require separate authorization. The local emulator does not validate deployed composite index availability.

Firebase edition could not be queried because the workspace has no Firebase CLI publishing identity. The implementation preserves the repository's existing Admin SDK/native Firestore architecture and changes no database edition.

## Read efficiency and limits

- Source pages are at most 200 registrations/complaints/audits or 10 eligible-population chunks. Capture queries read at most 101 minimal student projections per transaction.
- Academic drill-downs operate on the authorized cached cohort; changing a filter does not reread every student profile.
- Visible reports refresh attendance/complaint/audit changes every 30 seconds using timestamp cursors with overlap and UID/document de-duplication. Complaint deletions reconcile on a full read at most every five minutes. The event catalog refreshes every five minutes. There are no added database listeners.
- Exports refresh source pages first, including a full complaint reconciliation, and never export only the visible table page. A failed refresh blocks export.
- At most 20 selected events/programs, 50,000 cached attendance source rows, and 10,000 exported records are permitted. Oversized datasets fail with an instruction to narrow scope, rather than silently truncating. Student history is bounded to 1,000 records per modal.
- Activities without recorded department/semester linkage are excluded when those classification filters are set. The UI explains this limitation. Officer and activity-type selections concern audit records; participation statistics use the selected source event/cohort.
- Legacy eligibility, missing historical timestamps, unsupported audit categories and unrecorded academic terms are never inferred. No historic student/profile migration is performed.

## Local validation

- Targeted reporting/attendance/complaint/history/permission/HTTP/navigation regression tests: 140 passed.
- Firestore emulator: 7 passed, including real paginated capture transactions with 205 students, snapshot membership, incremental queries and default-denied private reporting collections.
- Browser end-to-end: actual pages and HTTP handlers over synthetic Auth/database fixtures; hierarchy, modal/Escape, XLSX download/reopen, complaint search/empty states, activity audit and 1440/768/390 layouts passed without JavaScript errors. Existing QR/scanner/registration/publishing workflows also passed. These are fixtures, not staging data or hardware camera tests.
- JavaScript syntax checks and isolated staging public build passed.
- Full `npm test` stops at 9 unrelated account-removal/Gmail login fixture failures. The same 9 failures reproduce on unchanged main `acde834` (45 pass / 9 fail in those two baseline test files). Legitimate tests were not disabled or bypassed.
- XLSX files were reopened with ExcelJS. An installed Microsoft Excel application was not available for native-app validation.

## Staging review pending

The workspace has no signed-in Firebase publishing identity or staging officer password. `scripts/prepare-reporting-staging-indexes.cjs` provides a fixed-staging, additions-only index preparation/check utility for execution locally with the existing staging service-account file. It rejects production credentials, preserves existing indexes, and never outputs tokens. Its guards are unit-tested; live application remains pending. Staging indexes and a signed-in end-to-end acceptance run therefore remain required. A successful Vercel build alone does not establish that those indexes are deployed or that authenticated live queries pass. Do not present the feature as fully staging-verified until this is completed.

No production data was read for tests or written by this change. No production backend deployment or PR merge is authorized by this document.

## Modified files

- `dashboard/js/events.js`
- `docs/reporting-and-analytics.md`
- `firestore.indexes.json`
- `functions/index.js`
- `package.json`
- `scripts/prepare-reporting-staging-indexes.cjs`
- `server/event-participation.cjs`
- `server/http.cjs`
- `server/officer-modules.cjs`
- `server/reporting-eligibility.cjs`
- `server/reporting.cjs`
- `server/runtime.cjs`
- `shared/event-participation-model.mjs`
- `shared/officer-permissions.js`
- `shared/participation-form.js`
- `shared/reporting-capture.js`
- `shared/reporting-data.mjs`
- `shared/reporting-export.mjs`
- `shared/reporting-model.mjs`
- `shared/reporting.css`
- `shared/reporting.js`
- `shared/security-client.js`
- `tests/browser/event-participation.cjs`
- `tests/event-attendance.test.mjs`
- `tests/event-participation.test.mjs`
- `tests/helpers/participation-fixture.cjs`
- `tests/helpers/student-records-fixture.cjs`
- `tests/hosted-management.test.mjs`
- `tests/reporting-firestore.test.mjs`
- `tests/reporting.test.mjs`
- `usc-admin/complaints/js/complaints.js`
- `usc-admin/events/js/events.js`
- `usc-admin/programs/js/programs.js`
- `usc-admin/reporting/reporting.html`
- `usc-admin/shared/js/nav-active.js`
