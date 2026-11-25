# Officer term dates — March expectation and actual turnover

## Current behavior

This version follows the user's latest instructions: one editable term start and an expected end in March of the academic year's ending year. It supersedes the earlier anniversary-based calculation and separate induction input.

| Academic year | Expected end, regardless of account creation date |
| --- | --- |
| 2026–2027 | March 2027 |
| 2027–2028 | March 2028 |

For example, a November 2026 appointment in 2026–2027 displays **March 2027**, not November 2027. Changing term start alone does not move the expected end. Changing academic year recalculates it in the form and trusted backend.

- Academic year accepts consecutive four-digit years separated by a hyphen, en dash or em dash. Invalid years are blocked before any assignment/account writes.
- Term start remains the sole editable date, entered in Philippine time. No induction field or induction prompt is required.
- Expected end is read-only month/year text. New records store `expectedEndMonth`, e.g. `2027-03`; no arbitrary day/time is recorded as an expected deadline.
- New assignments remain active until explicit completion. After March has passed, status shows **Active — awaiting turnover**. The end of the month is only a display-status boundary, never an access cutoff.
- Administrator **Complete term** records actual end and reason, returns the officer to student role, removes officer permissions and uses the existing Auth synchronization/retry path. School standing and account restrictions remain authoritative.
- Account UID, credentials, Student ID, historical assignments and activity remain intact.

The user supplied CBL excerpts about March induction, an induction anniversary and succession by proclamation. The March month/year is the user's requested operational estimate; the system does not claim a universal CBL deadline on a particular March day. Actual turnover remains an authorized administrative action and requires no election module.

## Existing records

- Existing active assignments already using `until-turnover` display a March estimate from their recorded academic year, including those saved under the prior anniversary calculation. The read response derives that display without rewriting database records or historical timestamps. Completed assignments retain their original expected-date history.
- Existing fixed-cutoff assignments retain the old access cutoff. Administrator **Adopt expected-end policy** still requires recent authentication, an authorization reason and confirmation explaining that this can restore access after the old fixed cutoff. March is calculated from the recorded academic year without another date prompt. Invalid legacy year formats require reconciliation rather than guessing a year.
- Completed, displaced, suspended, removed, graduated and Dropped accounts cannot be restored by policy adoption. Permission scopes and office-slot uniqueness remain enforced.

## Before and after

```js
// Previous local revision:
expectedEnd(termStart); // November 2026 -> November 2027

// Current trusted calculation:
expectedEnd('2026–2027'); // '2027-03'
```

The current form has one start-date input and a read-only **March YYYY** result. Actual end and deactivation reason remain in historical terms.

## Modified files in the latest revision

- `server/officer-term.cjs`: validated academic-year-to-March calculation, current-estimate projection and overdue display status; existing access predicate unchanged.
- `server/officer-history.cjs`: authoritative month storage, safe projections for existing active assignments, roster and legacy adoption.
- `shared/officer-history.js`: academic-year-driven read-only display and month-aware status labels.
- `usc-admin/admin-dashboard/officer-management.html`: read-only text result, March instruction, cache version.
- `tests/officer-term-policy.test.mjs`: academic-year parsing, November creation, same-year consistency, month boundary, trusted calculation, legacy access and completed-history preservation.
- `tests/browser/officer-management-only.cjs`, `tests/browser/officer-history.cjs`: month expectations; current management browser checks the actual form and hosted handlers.
- `docs/officer-administration.md`, `docs/officer-management-workflow.md`, this document: revised behavior and release requirements.

The preceding reviewed commits also contain the single-date simplification, actual-end fields, assignment policy, authorization/rules integration and related tests. No further rules changes were needed for the March revision.

## Actual validation

- `npm run test:officer-history`: **43 passed, 0 failed**.
- Hosted management, officer RBAC, announcement review, Needs Assessment and account-provisioning regression group: **36 passed, 0 failed**.
- JavaScript syntax check passed; modified backend CJS syntax checked separately.
- Current management browser passed at 1440, 768 and 390 pixels with actual controllers/HTTP handlers and synthetic Firebase/Auth data. Checks include November start → March of the academic-year ending year, academic-year edits, absent induction field, read-only result, legacy adoption, actual completion date/reason, preserved identity and existing directory/roster behavior. No browser errors. Screenshots are local artifacts, not a hosted Preview.
- Firestore emulator testing for the preceding policy change remains blocked by JAR download HTTP 403. The March revision does not change rules. Deployed rules, real Firebase authentication and isolated staging services remain unverified. The older standalone history browser was updated but not run.
- No live student/officer records, passwords, production settings or services were modified. The approved single-date revision was not pushed: the user paused that push before publication.

## Release coordination

The latest changes require fresh approval before pushing. The user performs the final merge. Prepare and verify an isolated staging Preview and validate the rules integration before claiming the whole policy is active.

Coordinate hosted frontend/backend and the preceding reviewed Firestore rules. Old rules still enforce fixed cutoffs, and old backend versions ignore the new policy/month fields. Merging application code does not deploy Firestore rules; production rules deployment requires separate explicit authorization.

Rollback application and rules versions together after reviewing assignments using the policy. Old fixed-cutoff checks can deny access again to officers serving beyond the expected month. A code rollback does not undo actual turnover or restore former permissions; reconcile authorized assignments while preserving history.
