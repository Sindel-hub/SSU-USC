# Student import correction and Dropped status

## Changes made

An ordinary older-year upload remains blocked. A separate, explicit **academic-year correction** option now accepts an authorized corrected file for an earlier year, requires a reason and a new reviewed preview, and appends correction history instead of deleting the newer import. Identity, names, duplicate IDs, programme validation, ownership, recent administrator sign-in and stale-preview checks remain enforced.

**Dropped** is accepted in the existing optional **Student Status** column in CSV and XLSX. Applying an explicit Dropped row blocks the linked profile, disables Firebase Authentication, revokes sessions, and clears access-related eligibility flags, using the same retryable journal as Graduated. Student ID, UID, password, officer role, office and unrelated history are retained. An unlinked Dropped record cannot be issued an account. Omitted students are unchanged.

Restoring portal access is a separate checkbox in correction mode. Each eligible Ready row explicitly says **Correct record & restore access**. Restoration requires:

- A current approved account, still inactive with a Graduated or Dropped standing and a trusted import-managed restriction marker.
- A completed disabling-import result for the same permanent UID and Student ID. Previously completed graduation imports using the older `graduationImportId` marker are supported.
- An explicit Student Status **Active** or **Undergraduate** in the correction file. Blank never restores access.
- A reviewed correction reason and administrator confirmation. Suspended, removed, pending-activation and unproven accounts are not restored.

Restoration keeps the same password, role and office. It does **not** infer the student's previous school-identity verification; that stays cleared for manual review. Retired-module flags are not administered here. Older academic snapshots did not preserve enough information to reconstruct prior verification safely. This is a reviewed correction, not deletion of the original test import or an exact rewind of every account field.

Auth synchronization is journaled and retryable. A failed enable/revocation/final profile write keeps the account blocked. A changed account, including a new suspension during synchronization, prevents restoration. Pending restoration must be resumed before another import can modify that account. Repeated/concurrent application creates one correction history entry and one restoration audit entry.

## How to recover the user's test after deployment

1. Correct duplicate Student ID **230383** in the spreadsheet shown in the screenshot. Correction mode does not bypass duplicates or identity conflicts.
2. Select the correct **2026-2027** file and academic year in Student Records.
3. Expand **Correct an earlier year / recover a test import**, select the correction checkbox, and enter the reason (for example, recovery from the 2027-2028 graduation test).
4. If portal access also needs restoration, separately select **Also restore approved accounts disabled by a completed import**. Put **Active** or **Undergraduate** in Student Status only for students authorized to regain access. If the original disabling import failed, resume it to completion first.
5. Validate and preview. Review Ready and Needs Review, including the target year and each access-restoration action. Apply only after confirming those rows.
6. Ask restored users to sign in again. Review school identity verification separately. Unlinked academic records have no Auth account to restore; their standing can be corrected through the existing record-only status control.

Do not expect an ordinary earlier-year upload, blank status or normal Undergraduate import to re-enable accounts. No live correction or account reactivation has been performed during development.

## Modified files

- `functions/student-records-model.js`: Dropped validation and a default-off older-year correction parameter.
- `functions/student-records.js`: explicit correction validation, import provenance checks, Dropped revocation, journaled access restoration and correction audit/history.
- `shared/student-standing.js`: Dropped is non-active and cannot access the portal.
- `firestore.rules`: Dropped validation and protection of server-managed restriction/restoration markers.
- `usc-admin/admin-dashboard/student-records.html`: correction controls, Dropped options and updated instructions.
- `usc-admin/admin-dashboard/js/student-records.js`: correction preview/resume/apply, readable actions, invalidated previews after edits, cleared stale progress, and disabled controls during requests.
- `usc-admin/admin-dashboard/users.html`: Dropped standing option.
- `tests/student-import-correction.test.mjs`: correction, legacy recovery, access/auth failure, authorization, concurrency, Dropped CSV/XLSX and data preservation checks.
- `tests/browser/student-import-correction.cjs`: real UI and service-handler recovery flow.
- `tests/browser/student-records.cjs`: preserve the existing graduation warning assertion with the updated Dropped wording.
- `tests/account-provisioning.rules.test.mjs`: server marker protection and permitted Dropped account standing.
- `tests/capstone-browser-mode.test.mjs`: updated supported-standing assertion.
- `package.json`: include correction tests in the student-records suite.
- `docs/annual-student-records.md` and this review: updated contract and recovery instructions.

## Before and after

Before, 2026-2027 was blocked after a 2027-2028 import, with no reviewed earlier-year correction option; Dropped was not an accepted Student Status. After, correction mode permits a reviewed earlier-year file while preserving both history entries, explicit eligible access restoration is available separately, and Dropped triggers account-access removal.

## Actual validation

- **107 focused automated tests passed** across correction, legacy import recovery, same-account year synchronization, graduation/drop revocation, retry/idempotency, manual-suspension races, recent-auth/admin restrictions, activation, history, roster, hosted routing and project integrity.
- New browser flow passed: Dropped disables the existing President account; normal older-year preview is blocked; correction plus explicit restoration returns it to 2026-2027; password/role/office/history remain; identity verification is not automatically restored; editing the target year invalidates the preview; desktop/tablet/mobile have no viewport overflow or page errors.
- Existing student import/registration/activation browser regression passed.
- JavaScript syntax and Git whitespace checks passed.
- Updated Firestore rules tests were attempted but the emulator download returned **HTTP 403: Domain forbidden**. Those tests cannot be claimed as passing. Run `npm run test:provisioning-rules` where the emulator download is available before deploying production rules.

Screenshots: `/tmp/student-import-correction-review/correction-preview-desktop.png`, `correction-ready-review.png`, and `correction-controls-{768,390}.png`.

Tests use synthetic Auth/Firestore and the actual service handlers; live Firebase authentication and production databases have not been tested or modified. The full unrelated application suite was not rerun.

## Deployment

Deploy the reviewed frontend and hosted management runtime together. Publish the reviewed Firestore rules separately with explicit production authorization, so browser clients cannot forge restriction/restoration markers and the directory accepts Dropped. No new endpoint, secret, index, SQL migration or Supabase Edge Function is introduced. If callable transport is explicitly enabled, deploy the matching Student Records service there as well.

The work is local until explicit approval to push. The user performs the final GitHub merge. A merge does not authorize this agent to alter live student records or run a production correction.
