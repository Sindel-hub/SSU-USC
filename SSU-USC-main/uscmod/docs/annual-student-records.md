# Annual student records and account provisioning

## Administrator workflow

Open **Student Records** in the System Administrator sidebar or use **Bulk student import** in User Directory. This is restricted to a trusted, approved, active administrator. Officers and students cannot call the record-management/monitoring endpoints.

1. Download the CSV template. Use an authorized USC list, not a direct Registrar connection. Replace the non-deliverable sample email with a real authorized address.
2. Select an academic year (`2026-2027`) and upload CSV or Excel `.xlsx`. Confirm the list is authorized, then Validate and preview. No student identity is created or changed during preview.
3. Review each proposed creation, update, status and validation error. Correct errors and upload again. An invalid preview cannot be applied. Every row is normalized and validated again on the server; frontend file parsing is not an authorization boundary.
4. Explicitly confirm and apply the reviewed import. Processing occurs in groups of ten, with per-row results. A resume reference is saved in session storage (not student records or passwords). You can load that reference after an interruption and retry. Completed rows are idempotent; partially applied Auth synchronization resumes without duplicating account/history records.
5. Existing Student IDs retain the same UID, role, permissions, password, email identity, complaints and activity records. Academic information is updated. Conflicting UID ownership or an email-identity change blocks the row for separate administrator reconciliation.
6. New students receive an unpredictable initial password that is never displayed, exported or emailed. Their Auth account is disabled and profile remains pending/inactive until activation. An expiring email link lets the student verify mailbox possession and choose a password of 12–128 characters.
7. Check activation delivery state. An unconfirmed delivery is not reported as sent. An administrator may explicitly resend after one minute, invalidating previous links. New links expire in 24 hours. Delivery does not mean the recipient has read the message or activated.
8. Students missing from a file remain unchanged and are labeled **Needs annual review** when their stored academic year differs from the selected year. Missing from one upload is not proof of graduation or discontinuation. To change access, import an explicitly authorized status for that student.

The original individual student/officer registration and existing User Directory remain available. The new bulk import is the primary annual-update path; no existing account is deleted by it.

## Import contract

- First sheet only; `.csv` or `.xlsx`, maximum 2 MB and 500 students per import. Split larger lists into reviewed batches.
- Columns: `studentId`, `fullName`, `department`, `program`, `yearLevel`, `email`, `status`. Descriptive headers such as Student ID / Full Name are normalized. Unknown/duplicate columns are rejected.
- Student IDs are 1–64 digits and must be stored as text. Excel numeric IDs are rejected rather than silently losing leading zeros. Native `.xls` is unsupported; save it as `.xlsx` or CSV.
- Full name is required (2–120 characters); department/program must match the existing SSU program catalogue; year level is 1–6 and is stored using the existing labels (for example, `2nd Year`).
- Email is required for new accounts. The user confirmed that the authorized list will include student email addresses. Duplicate IDs/emails and invalid/missing values are identified before application. Existing accounts may omit email; supplied email must match an existing email identity. Annual imports never replace an existing password or email.
- Statuses: `active`, `leave`, `inactive`, `graduated`, `transferred`, `withdrawn`, `eliminated`. Blank status defaults to active, clearly shown in preview. Non-active statuses block access, disable Auth and revoke refresh tokens without deleting the account. Non-active imports clear the legacy verified-student flag for compatibility with existing account rules.
- Current-year corrections append another history entry. Older-year imports cannot overwrite a newer current academic year.
- Existing suspensions and manual access blocks are preserved on active imports; the import does not approve a suspended account. Reactivation after a status managed by this import service is supported. Separate administrator access review remains necessary for unrelated manual Auth disablement.

## Identity, consistency and recovery

The server reconciles `student_id_claims`, `school_accounts` and profiles found by exact Student ID. Conflicting/missing identity ownership blocks processing rather than guessing or creating another account. Removed/removal-pending accounts require authorized recovery. New UIDs are deterministically derived from Student ID so a retried provisioning operation cannot create a second UID. Email collisions with other accounts are rejected by both preview and Firebase Auth.

A preview records a fingerprint of relevant identity, role, status and academic fields. An apply transaction verifies the fingerprint and ownership before writing the profile, ownership records, masterlist and immutable-per-import academic history. Concurrent changes require another preview. An academic revision number detects even a prior import that wrote otherwise identical data. Each row records its pre-change and post-change academic snapshot, academic year, import ID, actor UID and time. Existing records from before this feature receive a baseline snapshot on their first update; missing historic data is not fabricated.

Auth and Firestore cannot share a transaction. A per-row journal marks Auth synchronization pending until it succeeds. New profiles and inactive students fail closed. An Auth failure is visible and retryable, without rewriting academic history. After activation, the ticket is consumed only when Auth and Firestore finalization are ready. Failures keep the profile blocked, retain the ticket for retry after its one-minute processing lease, and do not falsely report completed activation.

No import endpoint accepts a caller-provided UID, role, password, permission set or verification flag. Privileged writes require recent administrator authentication. New callable clients never fall back to direct browser writes.

## Activation and email

The server uses a random 256-bit token and stores only its SHA-256 hash. The email link places the token in a URL fragment, and the activation page immediately removes it from browser history and uses a no-referrer policy. Tokens cannot select an arbitrary UID/email and successful tokens cannot be reused. Mailbox verification occurs only after possession of the link is established; bulk provisioning does not mark email verified.

Activation respects the current academic/account status. A student may establish a password while inactive but remains blocked from the portal. This is mailbox verification against the administrator-supplied address; it is not independent Registrar verification of identity/enrollment. Incorrect authorized lists must be reconciled by the administrator.

New Firebase Functions email configuration, distinct from the existing Supabase email service:

- Secret: `STUDENT_ACTIVATION_RESEND_KEY` (Resend API key; never put it in source or chat).
- Environment: `STUDENT_ACTIVATION_FROM` (a verified sender).
- Environment: `STUDENT_ACTIVATION_ORIGIN` (exact HTTPS frontend origin, without a trailing slash; no caller-selected redirect).

Only `studentAnnualApply` and `studentActivationResend` bind the email secret. Messages contain the activation instructions, not a password. Sender authorization, quotas, bounce handling and App Check/rate controls must be verified in staging before public use. Function concurrency is capped; valid 256-bit tokens and processing leases protect activation, but this is not a comprehensive anti-abuse system. A provider timeout is reported as unconfirmed rather than triggering an automatic resend. Do not send real activation emails during local tests.

## Monitoring and history access

Student Records supports exact Student ID search, paginated profiles and filtering of loaded records by status. Records show current department/program/year, academic year, standing, access and activation state. The detail screen reads:

- Up to 100 most recent academic history entries.
- Up to 100 UID-linked complaint summaries (not private complaint body text).
- The existing student sign-in aggregate.
- Up to 100 UID-linked event/program registrations.

The event/program query may require a collection-group index on `registrations.studentUid`; if unavailable, the interface reports the limitation instead of showing invented activity. Complaint/registration queries are bounded and are not a complete institution-wide monitoring feed. Filtering applies to the currently loaded profile pages. Anonymous Needs Assessment responses are never linked back to these profiles. No tracking outside USC services is introduced.

Private collections: `annual_student_imports` (with `results`), `student_activation_tickets` and `/users/{uid}/academic_history`. The existing Firestore default-deny rules prevent direct browser access. Current profiles remain subject to the existing owner/admin permissions; no Firestore rule changes were made. The index source includes the registration query index and an exemption for unqueried preview entries; neither is deployed. The Admin SDK performs controlled backend writes. No automatic retention deletion is added. Import previews expire for application after 24 hours but remain stored until an authorized retention policy is established; history, student accounts and service records are not purged.

## Staging and production gates

This implementation is local and undeployed. Firebase staging access was unavailable during the preceding work and remains unverified. No live Firebase/Supabase/Vercel configuration or live data was changed, and no real email was sent. The existing frontend Firebase configuration remains unchanged; do not test imports against production.

Before a functional hosted Preview:

1. Obtain explicit authorization, authenticate to isolated Firebase project `ssu-usc-email-staging`, verify its database edition and Functions billing eligibility, and prepare a staging web Firebase configuration. The current code uses the existing Firestore Admin SDK API; no database has been provisioned or upgraded.
2. Configure only staging email secrets/sender/origin, App Check, authorized frontend domains and the `registrations.studentUid` collection-group index provided in `firestore.indexes.json` (preserving all existing index definitions). Use only synthetic students and controlled test mailboxes.
3. Separately approve and deploy only these seven functions: `studentAnnualPreview`, `studentAnnualApply`, `studentAnnualJob`, `studentActivationResend`, `studentActivateAccount`, `studentRecordsList`, `studentRecordDetail`. Do not redeploy unrelated election/email/survey functions.
4. Run real Auth/Firestore integration tests, including simultaneous imports, interrupted Auth writes, denied officer/student access and activation resend/failure cases. Inspect live portal access after non-active status changes. Verify quota and email delivery behavior.
5. Review and approve exact frontend changes before any push/PR. Production backend deployment and final activation require separate explicit approval. The user performs the final PR merge.

No production backend is deployed automatically by these code changes.

## Verification and third-party parser

`npm test` includes model, CSV/real-Excel parsing, authorized service calls, status/history updates, stale/duplicate/expired import protection, interruption recovery, activation security and private monitoring tests. Auth/Firestore service tests use serialized in-memory doubles, not live Firebase. The isolated browser test (`node tests/browser/student-records.cjs`) runs real UI and service logic with these synthetic doubles and substitutes authentication/transport; it never sends real mail or contacts production.

The local ExcelJS browser build is pinned to 4.4.0, obtained from the npm `exceljs@4.4.0` distribution, with its MIT license in `vendor/exceljs/LICENSE`. No external spreadsheet CDN or new runtime package installation is needed. The browser checks ZIP metadata before extraction (at most 200 internal files and 20 MB declared expanded size); formulas and numeric Student ID cells are rejected. This is a bounded authorized-admin import path, not a general-purpose malicious-document scanner.
