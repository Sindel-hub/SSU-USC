# Student Record authority for year level

## Changes made

- User Directory displays year level in a read-only text field, with the source academic year. It reads the linked canonical Student Record through the existing authenticated lookup endpoint rather than presenting a stale account value as official. This also supports sixth-year records.
- Accounts without a linked imported Student Record show **Not recorded**. Failed or conflicting lookups show **Unavailable** and can be retried by reopening the account. A delayed response cannot overwrite a different selected account.
- A successfully applied authorized Excel import now mirrors year level and academic year into the same linked account and school-account index in the transaction that saves the Student Record, masterlist and academic history. Previewing a file makes no changes.
- Normal year updates preserve the UID, password, officer role, position, assignment, permissions, verification and access flags. The existing explicit graduation policy remains in effect; this change does not reactivate restricted accounts.
- Directory saves omit year level from account, masterlist and election-roster writes, so unrelated status edits cannot overwrite a newer import with an old year. Browser and legacy callable paths reject manual year changes. Firestore rules additionally protect account year and import-link metadata from browser changes.
- An academic-only live update refreshes the open year field without clearing other unsaved editor values. Existing field layout, account actions, registration and officer management remain intact.

## Before and after

| Before | After |
| --- | --- |
| Imported record could say 3rd Year while User Directory displayed an older account year | Directory details read the canonical imported year |
| Editable year dropdown could overwrite account-related data | Read-only imported value; directory writes exclude year |
| Applying an import did not synchronize account year | Applying it synchronizes the same account, retaining identity and access |
| Old account forms could resend an outdated year | Unrelated saves cannot write that field |

The Excel format is unchanged. Use the existing **Year Level** column (1–6), validate/preview the authorized file, then apply it. Correct a mistaken imported year through a reviewed correction import for the same academic year; both history entries remain preserved. Merely changing a local spreadsheet does not update the website.

## Existing data and deployment

No live data migration or backfill is run. Existing imported records display correctly in the account-details modal after this revision is deployed, even if the stored account mirror is older. Other consumers of the account mirror, including account-based CSV exports, receive the synchronized value on the next successfully applied import. Reapply a reviewed current-year file if those old mirrors also need correction.

Deploy the frontend and hosted management runtime from the same reviewed revision. The hosted runtime already loads `functions/student-records.js`; no new endpoint, credentials or Supabase Edge Function is introduced. Publish the reviewed `firestore.rules` separately with explicit production authorization to enforce the restrictions against older browser clients. Deploy the legacy `adminUpdateUser` callable only if that transport is used. No production backend deployment is performed here.

## Modified files

- `functions/student-records.js`: transactional academic mirror synchronization.
- `shared/security-client.js`: reject manual year changes and omit academic fields from directory writes.
- `functions/index.js`: matching guard for the legacy callable.
- `firestore.rules`: protect account year and import-link metadata.
- `usc-admin/admin-dashboard/users.html`: read-only year and source note; new asset versions.
- `usc-admin/admin-dashboard/js/admin-users.js`: canonical lookup, stale-response isolation, live academic refresh and no manual-year submission.
- `usc-admin/admin-dashboard/js/admin-core.js`: expose import revision/year for refresh and omit year from account updates.
- `usc-admin/admin-dashboard/css/users-modern.css`: read-only field treatment.
- `tests/student-records.test.mjs`: update the repeated-import regression to require a synchronized account year while retaining identity/history assertions.
- `tests/student-year-authority.test.mjs`: same-account student/officer sync, restricted-access preservation, canonical lookup, corrections/retries and stale-save/manual-write prevention.
- `tests/officer-management-access.test.mjs`: callable manual-year rejection.
- `tests/account-provisioning.rules.test.mjs`: direct browser year/academic-year mutation rejection.
- `tests/admin-user-directory-search.test.mjs` and `tests/admin-user-directory-ui-polish.test.mjs`: asset-version expectations.
- `tests/browser/imported-year-directory.cjs`: actual import/lookup HTTP flow and real directory UI with synthetic Firebase/Auth.
- `package.json`: include the new authority tests in the student-records suite.
- `docs/imported-year-authority-review.md`: this review.

## Actual validation

- **107 focused automated tests passed** across imports, activation, graduation, academic history, officer turnover/permissions, browser/callable guards, directory structure, hosted routing and static startup/project checks.
- JavaScript syntax validation passed.
- New browser flow passed: stale legacy account displays its canonical 2nd Year; field is read-only; directory save omits year; preview changes nothing; applying the file displays 3rd Year on the same President account; credentials/role remain unchanged; academic refresh preserves unsaved notes; missing-record, failed-lookup/retry and delayed-response isolation work; desktop/mobile layout has no viewport overflow or page errors.
- Existing 74-account directory browser regression passed, including real touch double-tap/swipe, pinned scrolling, keyboard access, filtered CSV, modal focus and scroll restoration.
- Firestore rules tests were attempted but could not start: the emulator download returned **HTTP 403: Domain forbidden**. They are included but are not claimed as passing. Validate them in an environment able to download the emulator before production rules deployment.
- Git whitespace checks passed. The full unrelated application suite was not rerun.

Screenshots: `/tmp/import-year-review/imported-year-before.png`, `imported-year-after.png`, `imported-year-mobile.png`.

All tests used synthetic records and isolated Auth/Firestore doubles. The browser exercised the actual management HTTP handlers. No real student accounts, production databases, authentication records or deployments were changed. Review and explicit approval are required before pushing; the user retains the final GitHub merge action.
