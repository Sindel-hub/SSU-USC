# Administration cleanup after election-module retirement

## Changes made

User Directory no longer includes **Bulk account updates**, **Export results CSV**, **Export selected CSV**, or their unused row-selection checkboxes. The related handlers and bulk-update helper are removed. Account names remain directly actionable, rows support double-click/double-tap, the horizontal scrolling handle remains, and the pinned identity column now starts at the left edge without an empty selection column.

Election-related administration has been disconnected:

- Removed candidacy approval, vote-status metadata and vote-subscription code from User Directory, Overview and Audit & Reports.
- Removed election-context lookups and election-roster writes from the account-update path. Browser and legacy callable account editors no longer change candidacy or canvasser flags.
- Excluded retired election permissions from administration's permission displays/counts and officer-term permission summaries. Stored historical permission lists are not rewritten.
- Audit & Reports retains its ordinary account-report exports, with vote-status columns and retired election permission keys removed. Its account-history feed omits explicitly retired module events without deleting the stored audit documents.
- Removed the unused old Registration Queue controller; the already-retired queue page still redirects to User Directory.
- Removed obsolete election wording from account/import screens and the retired officer-registration controller.

School identity verification remains an account-management feature. Individual approval, suspension, reactivation, removal/unlinking, password reset, read-only imported year, student registration, officer promotion and academic history remain intact. No account records or historical databases are deleted.

The previously prepared earlier-year correction and Dropped-status changes remain on this development branch. The final consolidated review diff includes that pending feature and this cleanup; neither has been pushed by this revision.

## Before and after

Before, the directory displayed bulk/export/candidacy/vote controls and passive account edits could still query or write election data. After, directory operations apply to individual accounts, Overview/Audit have no vote subscriptions, and account updates no longer touch election collections.

## Modified files

Implementation:

- `usc-admin/admin-dashboard/users.html` and `css/users-modern.css`: remove controls/selection column, keep pinned-name and responsive account layout.
- `usc-admin/admin-dashboard/js/admin-users.js`: remove bulk/export/selection, candidacy and vote handlers; filter retired permissions.
- `usc-admin/admin-dashboard/js/admin-core.js`: remove vote subscriptions, vote summaries and bulk helper; keep account-only audit export/history.
- `usc-admin/admin-dashboard/js/admin-dashboard.js` and `js/admin-audit.js`: stop vote subscriptions and remove vote display/export data.
- `usc-admin/admin-dashboard/js/admin-queue.js`: delete obsolete retired controller.
- `usc-admin/admin-dashboard/admin-dashboard.html`, `audit.html`, `officer-management.html`: refresh changed module asset versions.
- `shared/security-client.js` and `functions/index.js`: account editors no longer read/write election data or administer removed election flags.
- `shared/officer-history.js`: hide retired election permission keys in term summaries.
- `functions/student-records.js` and `usc-admin/admin-dashboard/student-records.html`: use account-identity wording in correction/restoration notices.
- `usc-admin/student-registration/js/officer-registration.js`: remove obsolete voting wording in the unused legacy controller.
- `package.json`: include administration-retirement regression tests.

Validation/documentation:

- `tests/admin-election-retirement.test.mjs`: removed UI/code paths, zero election reads/writes during account updates, legacy flag isolation, account-only exports/audit history.
- `tests/admin-user-directory-search.test.mjs`, `tests/admin-user-directory-static-flow.test.mjs`, `tests/admin-user-directory-ui-polish.test.mjs`: replace intentionally removed-feature assertions while retaining account/scroll/role protections.
- `tests/browser/user-directory-navigation.cjs`: retain 74-account interaction tests; replace removed checkbox/export expectations with absence checks; test Overview/Audit without election subscriptions.
- `docs/annual-student-records.md`, `docs/student-import-correction-dropped-review.md`, and this review: current account-only behavior and retained pending recovery feature.

## Actual validation

- **138 focused automated tests passed** across administration cleanup, individual verification and role/year guards, directory UI, imports/corrections/Dropped, academic history, officer turnover/roster, hosted routing and project integrity.
- JavaScript syntax checks passed.
- Browser checks passed with synthetic records: directory at 1440/768/390 pixels, native double-tap and swipe scrolling, name/keyboard opening, preserved modal focus/list position, pinned names/sticky headers, search/sort, absence of removed controls, permission filtering, and Overview/Audit without election requests or subscriptions.
- Earlier-year correction/Dropped browser flow passed. Officer promotion, completion and registered-officer-table browser regression passed. No browser page errors.
- Git whitespace checks passed.

Local directory screenshots: `/tmp/admin-account-only-review/user-directory-{1440,768,390}.png`. Overview/Audit screenshots are in the same directory.

The browser harness uses isolated Auth/Firestore data; production data and live Firebase services were not modified. The full unrelated application suite was not rerun. The earlier Firestore emulator download remains blocked by HTTP 403, so pending rules changes have not been validated by the emulator or deployed.

## Deployment and approval

The cleanup introduces no database migration or credentials. Ship reviewed frontend/shared/hosted code together; deploy the legacy `adminUpdateUser` callable separately only if that transport is used. Pending correction/Dropped Firestore rules still require their own production authorization and validation. No production operation is performed here.

Per `AGENTS.md`, explicit approval is required before pushing the updated scope. The user retains the final GitHub merge action. Historical election data and unrelated stored records remain untouched.
