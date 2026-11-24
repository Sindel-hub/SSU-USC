# Annual student records and account provisioning

> Hosted deployment update: the website now defaults to its own Vercel management API. Firebase Cloud Functions/Resend instructions below describe the optional original path. See [hosted-management.md](hosted-management.md) for the current Spark-compatible architecture, staging gates and private configuration. No hosted deployment has been performed.

## Administrator workflow

1. Open **Student Records** from User Directory. Download the CSV template, select the academic year, and upload an authorized CSV or Excel workbook. Use the first sheet and store Student IDs as text. Each upload supports up to 500 rows and 2 MB.
2. Validate and review the preview before confirming. It distinguishes matched accounts, new accounts, and records that will wait for an email. Resolve conflicts and correct invalid rows, then generate a new preview. Previewing never changes student records or Auth accounts.
3. Apply the confirmed import. Each row saves the academic record and its history before the service attempts account provisioning. New eligible accounts use the saved record and remain disabled until the student activates from the emailed link and chooses a password. A missing address leaves a record without an account. Add the confirmed address on a subsequent import for the same identity.
4. Retry interrupted provisioning from the import reference. The saved record's permanent ID is reused. Completed rows are idempotent. After the preview expires, rows already saved can resume, and rows never applied require a new preview.
5. Use User Directory for a linked account's access and student status. For records without an account, set student status in Student Records. An annual file updates enrollment classification and academic information while keeping existing account access unchanged.

## Import contract

Use these columns in order: Student ID, Last Name, First Name, Middle Name, Suffix, College Department, Course / Program, Year Level, Enrollment Status, Institution Email (Optional). Middle Name, Suffix, and Institution Email may be blank. Student IDs preserve leading zeros. Display names are generated as First Name M.I. Last Name Suffix, with the original name parts retained.

Use the official department/program catalogue and year levels 1 through 6. Enrollment classification (for example Regular or Irregular), student status (for example Currently enrolled or Graduated), and account access are managed independently. An import never changes an existing Auth identity, password, activation, role, permissions, or manual access restriction. Existing email changes require the separate verified account workflow. An account absent from the file receives no writes.

## Identity, history, and recovery

`student_records/{uid}` holds the central record, indexed by Student ID in `student_record_ids`. A matched account keeps its Firebase UID. New records receive a permanent random UID before provisioning. A mismatched name, linked account, or competing Student ID/email reservation blocks the row for administrator review. The service does not automatically reassign IDs to new students. Academic history is stored by permanent UID in the existing academic history subcollection. A same-year correction records changed fields, and an older year cannot overwrite a newer one.

Schedule a staging backup of Firestore and Firebase Auth under the existing restricted backup process before applying the new rules and hosted workflow. Validate using synthetic records first, including an omitted active account, an email-less record, a conflicting Student ID, a failed provisioning retry, and an annual correction. Capture a recovery point before any separately authorized production rollout. For import reconciliation, use the audit events and per-row journal to identify affected records. Review recovery per UID before making any restorations so later password, activation, or status changes are preserved.

## Activation and email

The server uses a random 256-bit token and stores only its SHA-256 hash. The email link places the token in a URL fragment, and the activation page immediately removes it from browser history and uses a no-referrer policy. Tokens cannot select an arbitrary UID/email and successful tokens cannot be reused. Mailbox verification occurs only after possession of the link is established; bulk provisioning does not mark email verified.

Activation respects the current academic/account status. A student may establish a password while inactive but remains blocked from the portal. This is mailbox verification against the administrator-supplied address; it is not independent Registrar verification of identity/enrollment. Incorrect authorized lists must be reconciled by the administrator.

New Firebase Functions email configuration, distinct from the existing Supabase email service:

- Secret: `STUDENT_ACTIVATION_RESEND_KEY` (Resend API key; never put it in source or chat).
- Environment: `STUDENT_ACTIVATION_FROM` (a verified sender).
- Environment: `STUDENT_ACTIVATION_ORIGIN` (exact HTTPS frontend origin, without a trailing slash; no caller-selected redirect).

Only `studentAnnualApply` and `studentActivationResend` bind the email secret. Messages contain the activation instructions, not a password. Sender authorization, quotas, bounce handling and App Check/rate controls must be verified in staging before public use. Function concurrency is capped; valid 256-bit tokens and processing leases protect activation, but this is not a comprehensive anti-abuse system. A provider timeout is reported as unconfirmed rather than triggering an automatic resend. Do not send real activation emails during local tests.

## Monitoring and history access

Student Records supports exact Student ID lookup and paginated filters for name, department, program, year level, academic year, enrollment classification, student status, and account status. Records show current department/program/year, academic year, standing, access and activation state. The detail screen reads:

- Up to 100 most recent academic history entries.
- Up to 100 UID-linked complaint summaries (not private complaint body text).
- The existing student sign-in aggregate.
- Up to 100 UID-linked event/program registrations.

The event/program query may require a collection-group index on `registrations.studentUid`; if unavailable, the interface reports the limitation instead of showing invented activity. Complaint/registration queries are bounded and are not a complete institution-wide monitoring feed. Anonymous Needs Assessment responses are never linked back to these profiles. No tracking outside USC services is introduced.

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
