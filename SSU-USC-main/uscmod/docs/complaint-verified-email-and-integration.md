# Tasks 4 and 5 — verified complaint/feedback contact and integration report

## Root causes and changes

Complaints previously used direct browser transactions. They enforced ownership and a cooldown, but never checked the verified Gmail mapping or institutional verification before saving. Review/status/feedback writes used browser compatibility fallbacks and best-effort audit logging; they had no durable, deduplicated transactional email event. The existing optional digest could not acknowledge every submission or reliably track individual delivery.

Submission and review now use the existing `usc-email` trusted service. Firestore blocks direct complaint creation/review and official attachment modification. A single backend commit saves the submission, immutable receipt, private attachment chunks, per-user cooldown and confirmation event; review commits save status/classification/feedback, action receipt, audit and an event for each meaningful status/feedback change. Network retries reuse request IDs. Receipts survive deletion, preventing old requests from recreating deleted cases. The existing 20-second cooldown still applies across Complaint and Feedback.

The form now explicitly supports Complaint and Feedback through the same module. Existing categories, limits, classification levels, one-way USC feedback, terminal deletion and the five statuses are retained: Submitted, Under Review, In Progress, Resolved, Closed. No Rejected or Additional Information Required status was invented. A clarification request is private official feedback with an attention flag; its email directs the student to Tracklist without including the message. Classification-only changes do not create transactional email.

## Shared verification and delivery

`verified-notification-email.mjs` contains the Task 3 verified-contact policy, moved without a separate verification system. Candidate exports remain compatible aliases. Gmail ownership, requested/verified mapping and verification timestamp must agree; institutional verification follows the existing trusted institutional identity. Account activity/ownership is rechecked. Generic `verified_email_status` returns only verified/source, not a private recipient. Candidate candidacy approval remains a separate requirement and does not block complaints.

`verified-notification-delivery.mjs` and `notification-adapter.ts` share claim/send/failed/unknown/retry behavior across candidate and complaint mail. The existing secret-protected worker processes both queues with the unchanged provider. It resolves the currently verified recipient at delivery time and never falls back to arbitrary profile text. Browser code queues changes through the trusted backend; it never sends provider email.

New authenticated service actions: verified_email_status, complaint_submit, complaint_update and complaint_notification_retry. Existing candidate and email identity/recovery actions remain supported. Callable updateComplaintCase forwards to the same trusted workflow.

Events have queued/sending/sent/failed/unknown/cancelled states and attempt counts. Versioned claims prevent competing workers or refreshes from sending twice. Confirmed failures can be explicitly retried by an authorized reviewer, with an audit entry. Unconfirmed provider responses/worker interruptions cannot be blindly retried; stalled sending claims become unknown after ten minutes and require provider reconciliation. Delivery failures never roll back saved cases. Legacy cases with missing ownership remain reviewable, with a failed notification requiring administrative reconciliation rather than guessing an address. Managed cases are excluded from the old student digest to avoid double notifications; legacy digests remain available.

## Private drafts and attachments

The existing verification popup is shared with candidate registration. Cancel preserves the current form. Connect saves the form to `complaint_drafts/{uid}/entries/{requestId}`, with a private latest-draft pointer and private attachment chunks, then opens the existing Profile drawer at its email settings. Text, evidence, filenames and verification tokens are not stored in local/session storage. The existing cross-tab lock stores only an opaque lock token/expiry.

A same-account reload restores type/category/date/title/details and private attachment references. Profile close refreshes verified-email status, without auto-submitting or requiring logout. Submission revalidates eligibility, fields, cooldown, evidence metadata/bytes and verified contact. Drafts have a 24-hour logical expiry and are removed after acknowledged submission; no automatic production asset deletion/migration runs.

Evidence retains the existing firestore-chunks format and authorized reader. Images remain limited to 3 MB; PDF/DOC/DOCX documents to 5 MB. Chunks are bounded, own-user, contiguous and size-validated. The backend atomically copies them to the completed complaint; students cannot append/change official evidence afterwards. Existing legacy attachment readers remain intact. Review permission is required for updates, with status/classify/feedback permissions checked only for actual changes. Existing approved-staff read access and classification semantics are preserved. Terminal chunk deletion now requires the same complaints.status permission as deleting the case.

Complaint createdAt/updatedAt, rate timestamps and case-audit dates retain Firestore timestamp types. This matters because the officer inbox paginates/orders in Firestore alongside older Timestamp records. The general workflow serializer supports backend Date values; mail queue timestamps remain numeric for existing worker claims.

## Confidentiality

Confirmation/status email contains only reference, status, date, generic acknowledgment/attention instructions and the authenticated Tracklist URL. It excludes names, Student IDs, category, classification, description, private feedback, evidence, addresses and auth tokens. Complaint events contain no body/evidence/recipient. Verified email is resolved server-side rather than copied into new complaint records. Existing private legacy studentEmail fields are not published or removed by this task.

Students can read only their own completed cases/attachments/events. Unsubmitted drafts are owner-only, including against other officers. Event writes, receipts and action claims are backend-only. No student reply path or classification assignment was added. No private complaint data was added to analytics or console logs.

## Files/components

- Student form: complaint/complaint.html, complaint/js/complaints.js; shared/complaint-drafts.js and shared/verified-email.js.
- Existing candidate helper and Profile drawer use the shared popup/return event; Student Tracklist keeps its authorized data listener and a neutral email-management hint.
- Officer Complaint HTML/JS/CSS: clarification checkbox, delivery indicator and authorized retry.
- Shared security client and callable updateComplaintCase delegate to the trusted service.
- Backend complaint workflow/adapter, shared contact/delivery adapters, existing usc-email and usc-email-worker, plus Date support in the versioned Firestore workflow serializer.
- Firestore rules: trusted-only completed records/reviews/evidence, private drafts, receipts/actions and events.
- scripts/build-staging-review.cjs, vercel.json and .gitignore: isolated Preview build guard.
- New workflow, emulator, browser, integration, digest-coexistence and build tests. Older tests were updated to exercise the actual trusted workflow instead of the deliberately retired browser-write implementation; legacy behavior/permission checks remain covered.

## Preview isolation — staging is unavailable

The user reconfirmed that isolated staging Firebase/Supabase projects are not available. A Preview must not fall back to production. The build therefore fails closed:

- VERCEL_ENV=preview requires STAGING_FIREBASE_WEB_CONFIG (public Firebase Web config JSON), STAGING_SUPABASE_URL and STAGING_SUPABASE_ANON_KEY (publishable/anon client key).
- The production project/URL and private Supabase keys are rejected. Unknown build environments also fail closed.
- Without valid staging configuration the output contains only setup HTML at application routes: no application scripts, Firebase/Supabase clients or backend calls. This is a **setup-gated Preview, not a functioning staging dashboard**.
- With staging configured, the artifact uses the staging Firebase client and replaces frontend Supabase/email/Facebook origins with the staging project. Production builds explicitly use VERCEL_ENV=production and preserve active client asset bytes. System environment variables must remain exposed during builds.
- Dev logs, server functions, tests, package/config files and documentation are not included as public static assets. Source/deployment settings are prepared in the PR; no production Vercel settings were changed.

To unblock end-to-end review, provision isolated staging Firebase/Supabase, configure their public client values for Vercel Preview builds, deploy the matching trusted email services/rules and controlled test-email configuration there, then rebuild. Firebase API/project/service-account settings must target that same staging project. Verify the worker scheduler and a controlled recipient. Do not use production students or real candidate/complaint mail for testing.

## Task 5 local verification matrix

- Task 1: distinct A/B identity, deterministic same-election duplicate prevention, concurrent attempts, active pointer/window checks and new-election eligibility with retained past history.
- Task 2: independent history search/filter/view/edit/delete, publication deactivation, missing/deleted schedule handling, correct student synchronization, account/ballot/result/audit preservation and permissions.
- Task 3: both verified contact types, pending/revoked contacts, candidate popup/cancel/Profile/draft reload, closed/changed election protection, queued approval/rejection/attention mail and private publication projection.
- Task 4: both Complaint and Feedback, required verified contact, private draft/evidence restoration, Profile return, cooldown/idempotency, every existing status, legacy classification/thread handling, private clarification, atomic audit/event, recipient revocation, failed/unknown delivery/retry, immutable evidence and own-student Tracklist updates.
- Cross-module: one newly verified mapping unlocks both eligible workflows without changing email mappings; candidacy approval stays separate; election/complaint queues coexist without duplicate digest mail.
- Recovery: synthetic backup hash integrity/restore preserves completed results and settled sent-state, so replay cannot resend. Atomic failure cases leave no partial submissions or mail events.
- UI: actual student/Officer/Tracklist modules with synthetic services, plus existing candidate/history workflows; popup sizes 320/390/768/1440 and history detail sizes through 1920. The real private attachment codec reconstructs the copied evidence.
- Build: a blocked Preview contains no application scripts; configured staging artifacts replace both backend clients; explicit production artifacts preserve active source bytes; private keys/unknown environments fail closed.

Commands: npm test; npm run test:task1-4-rules (demo Firestore only); npm run test:complaint-email-browser; npm run test:candidate-email-browser; npm run test:registration-history-browser; Deno check of usc-email and usc-email-worker. Exact counts/results and the actual deployment URL are recorded in the PR.

## What is not verified or changed

All tests use local synthetic fixtures/demo emulators. No production records were inspected, backed up, overwritten or deleted; no destructive migration and no real mail send ran. The recovery test is a synthetic exercise, **not verification of a production backup**. Staging deployment/IAM/provider delivery, live email callbacks and production recovery remain unverified because staging does not exist. Existing legacy external attachment storage retains its current policy and requires staging review; no live URL/bucket migration ran.

Task 3's legacy campaign-photo metadata privacy prerequisite remains: audit/redact contact metadata through an authorized backend before rolling those rules out. Do not infer ownership or rewrite legacy complaints automatically.

## Deployment and rollback gate

Keep the PR draft until isolated staging review passes. Deploy the shared backend services/rules and client together; cached clients using direct complaint writes must refresh. Production backend changes require separate explicit authorization. Before any authorized production data operation, take a scoped backup, verify its manifest/hash and restore into isolation, and reconcile queued/sending/unknown mail with provider records. Do not restore stale queued-state blindly or resend uncertain events.

No automatic merge or production deployment is authorized. The user merges manually after review. A rollback must preserve cases, receipts, action claims, audits and delivery state; retain the trusted-write firewall and verified-contact checks rather than restoring permissive browser fallbacks. Review and reconcile events before enabling/retrying a worker after recovery.
