# Annual student records and account provisioning

> Hosted deployment update: the website now defaults to its own Vercel management API. Firebase Cloud Functions/Resend instructions below describe the optional original path. See [hosted-management.md](hosted-management.md) for the current Spark-compatible architecture, staging gates and private configuration. No hosted deployment has been performed.

## Import the School Class List (SCL)

1. Open **Student Records**, download the template, select the academic year, and upload an authorized CSV or Excel workbook.
2. Validate the file, review **Ready** and **Needs Review**, then select **Apply Ready Records**. The apply endpoint skips blocked rows and saves academic records. It creates no Firebase accounts and sends no email. Review results can be reopened by import reference.
3. Correct spreadsheet errors in the source and upload the corrected rows. For a name mismatch on an existing account with the same Student ID, compare both names, verify the person against an authorized source, and record the reference using **Verify same person**. That row can then be applied. Ownership and UID conflicts stay blocked for separate review.
4. Account access and existing account fields are managed in User Directory. The import can link a verified matching account to an SCL record while preserving its UID, credentials, permissions, and history.

## Issue an account at the USC office

1. Use **Register student account** in User Directory. Look up the student's exact Student ID and review the saved information. A missing or ineligible masterlist record cannot be used for issuance.
2. Verify the student in person and explicitly issue the account. User Directory will show it as pending activation. A duplicate Student ID is blocked, including if it belongs to an older existing account.
3. Hand the one-time activation link privately to the verified student. The link expires after 24 hours and lets the student choose their password. Institutional email is optional. In-person links do not verify an email address.
4. If the link was lost, verify the student again before replacing it. The previous link becomes invalid. Existing email activation and the authorized email resend action are available for accounts with an institutional email.

Previews from the earlier import-and-provision workflow must be regenerated. Any incomplete Auth issuance from an earlier release should be checked for ownership before processing.

## Import contract

Use these columns in order: Student ID, Last Name, First Name, Middle Name, Suffix, College Department, Course / Program, Year Level, Enrollment Status, Institution Email (Optional). Middle Name, Suffix, and Institution Email may be blank. Student IDs preserve leading zeros. Display names are generated as First Name M.I. Last Name Suffix, with the original name parts retained.

Use the official department/program catalogue and year levels 1 through 6. Enrollment classification (for example Regular or Irregular), student status (for example Currently enrolled or Graduated), and account access are managed independently. An import preserves existing Auth identity, password, activation, role, permissions and manual access restrictions. An explicit Graduated Student Status now adds the access-removal behavior documented below. Existing email changes require the separate verified account workflow. An account absent from the file receives no writes.

## Identity, history, and recovery

`student_records/{uid}` holds the central record, indexed by Student ID in `student_record_ids`. A matched account keeps its Firebase UID. New records receive a permanent random UID before provisioning. A mismatched name, linked account, or competing Student ID/email reservation blocks the row for administrator review. The service does not automatically reassign IDs to new students. Academic history is stored by permanent UID in the existing academic history subcollection. A same-year correction records changed fields, and an older year cannot overwrite a newer one.

Schedule a staging backup of Firestore and Firebase Auth under the existing restricted backup process before applying the new rules and hosted workflow. Validate using synthetic records first, including an omitted active account, an email-less record, a conflicting Student ID, a failed provisioning retry, and an annual correction. Capture a recovery point before any separately authorized production rollout. For import reconciliation, use the audit events and per-row journal to identify affected records. Review recovery per UID before making any restorations so later password, activation, or status changes are preserved.

## Activation and email

Email and in-person activation use a random 256-bit token and stores only its SHA-256 hash. The email link places the token in a URL fragment, and the activation page immediately removes it from browser history and uses a no-referrer policy. Tokens cannot select an arbitrary UID/email and successful tokens cannot be reused. Mailbox verification occurs only after possession of the link is established; bulk provisioning does not mark email verified.

Activation respects the current account status. Email delivery verifies the administrator-supplied mailbox; it is not independent Registrar verification of identity/enrollment. Incorrect authorized lists must be reconciled by the administrator.

New Firebase Functions email configuration, distinct from the existing Supabase email service:

- Secret: `STUDENT_ACTIVATION_RESEND_KEY` (Resend API key; never put it in source or chat).
- Environment: `STUDENT_ACTIVATION_FROM` (a verified sender).
- Environment: `STUDENT_ACTIVATION_ORIGIN` (exact HTTPS frontend origin, without a trailing slash; no caller-selected redirect).

Only `studentActivationResend` binds the optional Functions email secret. Messages contain the activation instructions, not a password. Sender authorization, quotas, bounce handling and App Check/rate controls must be verified in staging before public use. Function concurrency is capped; valid 256-bit tokens and processing leases protect activation, but this is not a comprehensive anti-abuse system. A provider timeout is reported as unconfirmed rather than triggering an automatic resend. Do not send real activation emails during local tests.

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


## Optional Student Status column and graduation access removal

The existing ten columns remain accepted unchanged. The updated downloadable template adds `Student Status` as column eleven, after `Institution Email (Optional)`. CSV and first-sheet XLSX use the same ordered headers. Student IDs must remain text in Excel; formulas and numeric IDs are rejected as before.

`Undergraduate` (also `Active`), `Graduated`, and blank values are accepted case-insensitively. Enrollment Status remains a separate classification such as Regular or Irregular. Blank/omitted Student Status and Undergraduate preserve every existing account restriction; a student absent from the file is unchanged. A direct legacy API `status` value alone does not trigger this new access-removal behavior.

An explicit Graduated row displays an access-removal action and warning in the existing preview. Nothing changes until an authorized administrator confirms and applies Ready rows. Matching continues to require the same Student ID ownership and name validation; existing reconciliation and recent-auth requirements remain in force.

For a linked student/officer account, the transaction marks the profile graduated/inactive, removes verification/candidacy eligibility, updates associated school/masterlist flags and records academic history plus the import journal. Role, permissions, password, account status, identity and unrelated history are retained. The service then disables Firebase Auth and revokes refresh tokens. Existing live profile watchers and server/database checks deny the inactive profile; already issued tokens cannot be assumed to disappear instantly. Completion is recorded only after Auth synchronization succeeds.

If Auth fails, the profile is already blocked and the per-row `access-pending` journal is retained. Load the existing import reference and apply again to resume revocation without rewriting history or failing its own stale-preview check. A manually changed profile prevents an old pending import from overwriting the new access decision. Missing Auth accounts require administrator reconciliation. Unlinked graduates remain records only and cannot be issued a new account.

A later Undergraduate row never re-enables access. To correct an accidental graduation, an authorized administrator must verify the correction, restore the appropriate User Directory standing/access state and explicitly re-enable that user in Firebase Authentication. Do not bulk-enable accounts or override suspensions. No automatic restoration is added by this change.

No UI layout, sidebar, navigation or CSS changes are included; only the existing instructions, preview warnings and confirmation text change. Deploy the reviewed parser/frontend and management API together. For explicitly configured callable transport, deploy the matching Student Records functions too. No live account changes or production deployment were performed during development.
