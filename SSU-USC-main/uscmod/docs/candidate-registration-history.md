# Candidate registration history (Task 2)

## Root cause and behavior

The current schedule deletion already retained subcollections, but cleared the active election pointer. The old application list depended on that pointer, so retained records disappeared from management. Schedule deletion also reset lifecycle and refused completed elections. Task 2 marks only schedule deletion metadata, retains the persistent election record and all its dates/lifecycle, and transactionally clears the pointer only when it still refers to that election. Browser and callable paths match. No candidate/document/audit/result/ballot cascade runs.

A dedicated Officer → Election Candidate Registration History section queries application collection groups independently of the active pointer. It supports name/Student ID search, election/application/election-state filters, date sorting, details/documents, and individual edits/deletions. Students have a read-only My registrations dialog. Removed records are hidden from normal history and current review lists.

## Records and authorization

Existing `elections/{electionId}/applications/{uid}` paths remain stable registration IDs within their election. New submissions also store registrationId and an electionSnapshot (title and registration/voting dates) read from the same election transaction. Existing election parents retain metadata after schedule deletion; physically missing legacy parents still allow collection-group discovery, with available stored metadata and Election ID. Missing historical names/dates are shown as unavailable, never fabricated. No backfill or destructive migration runs.

Management uses Firestore transactions and server-enforced `elections.review` permission for active approved officers/admins. Immutable audit entries contain actor, election/registration IDs, original and resulting record, and server timestamp. Soft deletion sets `removed`, atomically deactivates the linked candidate publication, and preserves its original result identity. Student accounts, other elections, ballots, voterStatus, vote totals, documents and audit history remain untouched. Editing the position/department after voting begins (or without reliable dates) is blocked. Existing finalized result documents are never rewritten. Historical records can be corrected without changing preserved result identities.

A removed application may be replaced at its deterministic path only while its election is still the current, open, unarchived registration window. The original record remains in the immutable deletion audit, and its old candidate publication stays deactivated. Duplicate active applications remain denied. Student listeners update the active registration immediately and ignore stale election callbacks; current and historical listings exclude soft-deleted records.

## Changed components

- `shared/candidate-registration-history.js` / `.css`: officer history and student history dialogs.
- `shared/registration-history-store.js`: authorized, audited record/publication transactions.
- `shared/security-client.js`, `functions/index.js`: preserve schedules, snapshots, tombstone-aware submission/review.
- `dashboard/js/election.js`, `usc-admin/elections/js/elections.js` and their HTML: live synchronization, history integration, current-list filtering.
- `firestore.rules`, `firestore.indexes.json`: scoped history queries/writes and applicantUid collection-group index. Token role reads use a safe default so officers without custom claims do not hit rule evaluation errors.
- New history unit, browser and emulator tests; existing Task 1 tests retained.

## Validation

`npm test` runs the full default suite. `npm run test:registration-history-browser` exercises actual HTML/history modules with synthetic Firestore fixtures: filtering, view/edit/delete, election isolation, student soft-delete synchronization and widths 320/390/768/1440. Set SSU_PLAYWRIGHT_MODULE / SSU_CHROMIUM_PATH if needed.

`npm run test:registration-history-rules` uses a demo Firestore emulator. Tests cover completed election edits/deletions, missing parent history, permissions, mandatory audit, publication deactivation, result/ballot preservation, own-user queries, schedule retention, tombstone replacement and closed/deleted registration denial. The Task 1 registration-scope rules suite also passes with these rules. No production student data is used.

## Registration details dialog

The view/edit dialog is explicitly centered within the viewport, with a persistent Close header and one contained scrolling body. Desktop separates the photo, status and election dates from candidate details, platform, supporting documents and review notes. Mobile stacks the same content, wraps long values and keeps form inputs at a readable size. Photos use contain to preserve the full image; missing photos use initials. Editing keeps the same field names, validation, transaction and submit behavior. No backend or authorization changes are part of this UI polish. Browser checks include long content, viewport centering, overflow and Close access at 320/390/768/1440/1920px.

## History loading failures

History has distinct loading, failure and successful-empty states. Permission, missing-index and connection errors show actionable messages with a Retry button; filters are disabled until a query succeeds. Failed listeners clear stale records, and metadata refreshes cannot replace an access error with an empty listing. The browser fixture covers error/retry recovery without changing database authorization.

## Preview and deployment dependency

There is **no isolated staging Firebase project**, confirmed by the user. Do not present the frontend Preview as fully functional for the new database operations. It uses the repository's existing service configuration; no test writes were made to that backend. Review its UI, but do not test record mutation against production data.

Before end-to-end review, provision an isolated Firebase staging project, configure the Preview client for it, apply these rules and indexes there, and wait for index readiness. If using callable mode, deploy the matching functions to staging as well. Verify review, submission, replacement, query and file access with synthetic staging accounts. Existing file authorization remains unchanged. Legacy documents may reference files no longer available; the UI reports existing access errors rather than broadening file permissions.

Production rollout requires separate explicit backend authorization and coordinated rules/index/client deployment. Old clients must refresh: physical application deletion is denied and new soft-delete writes require these rules. Do not merge until staging review is complete. The user merges the PR manually. Rollback: revert the frontend review commit; retain backend audit/tombstone records and do not restore permissive destructive delete rules.

## Task 3 verification integration

The later verified-email change moves submission/review writes to the existing trusted email service and adds private drafts and notification events. Its deployment and legacy photo metadata privacy dependencies supersede the earlier browser-submission rollout notes here; see `candidate-verified-email.md`. History edits/soft deletion remain the same audited operations.
