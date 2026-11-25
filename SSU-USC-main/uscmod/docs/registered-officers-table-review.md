# Registered USC officers table

## Changes made

A separate **Registered USC officers** table appears above the promotion form in Officer Management. It shows the officer's name, Student ID, USC position, department, administration and term dates, account status, and term status. Legacy officer accounts show **No term recorded**. Restricted officer accounts remain visible with their actual status; removed accounts and accounts pending removal are excluded.

The table reads `users` records carrying the officer role through an administrator-only hosted endpoint. It joins only assignments belonging to the same UID and returns selected display fields. It does not return emails, credentials, permission lists, or private appointment references. Registered accounts are listed independently from the historical assignment cards.

The existing Refresh button reloads the table. Successful promotion and term completion also refresh it; returning an officer to student access removes that person from the current roster and retains their historical assignment. Lists over 50 records offer **Load more officers**, with the badge explicitly indicating a loaded count while more pages remain. Empty, loading and retry states are included. Mobile users scroll the table horizontally within its container.

No account data, promotion permissions, review workflow, sidebar or navigation layout is changed by this read-only feature.

## Modified files

- `usc-admin/admin-dashboard/officer-management.html`: separate table and cache versions.
- `usc-admin/admin-dashboard/css/officer-management.css`: table, status badges and contained scrolling.
- `shared/officer-history.js`: safe DOM rendering, pagination, refresh integration and error handling.
- `server/officer-history.cjs`: authenticated administrator-only `officerDirectory` query and safe term projection.
- `server/http.cjs`: allow the new authenticated action through the hosted router.
- `tests/officer-directory.test.mjs`: database filtering, privacy, pagination, authorization and turnover checks.
- `tests/hosted-management.test.mjs`: include the new action in router checks.
- `tests/browser/officer-management-only.cjs`: verify roster population, safe text, legacy/restricted accounts, turnover, pagination, retry and mobile scrolling.
- `package.json`: run roster tests with the existing officer-history suite.
- `docs/registered-officers-table-review.md`: this review.

## Before and after

Before, administrators could see assignment history but had no separate roster covering all currently registered officer profiles, including legacy accounts without a term. After, the dedicated table lists those profiles without mixing former officers into the current roster.

## Actual verification

- Officer-history suite: **33 passed**, including five new roster tests.
- Hosted-management suite: **18 passed**.
- Static project checks: **6 passed**.
- JavaScript syntax suite: **passed**.
- Browser flow: **passed** at 1440, 768 and 390 pixels. Actual pages/controllers and hosted HTTP handlers used synthetic Firebase records/Auth. Verified no page overflow, usable table scrolling, roster changes after promotion/completion, 52 distinct rows after pagination, escaped names, and recovery from a simulated roster outage. No browser page errors.

Local screenshots: `/tmp/officer-roster-review/registered-officers-table.png` and `officer-management-{1440,768,390}.png`. Live Firebase services and a hosted Vercel Preview were not used. No production records were accessed or modified.

The hosted endpoint and frontend must ship together after review; no Firestore rules, index definitions, credentials or database migration are changed. The branch remains local until explicit approval to push; the user retains the final GitHub merge action.
