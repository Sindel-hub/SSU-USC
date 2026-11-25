# Expected and actual officer term dates

## Changes and basis

Implements the user's requested distinction using their quoted CBL provisions: Article VI Section 3 for proclamation through successor proclamation, Article XVI Section 8 for the estimated anniversary of induction. The source PDF was not supplied for independent verification. The application records authorized appointments and turnover; it does not infer that successors were proclaimed or require an election module.

- Academic year remains the existing administration value.
- Term start records proclamation in Philippine time. Induction is a separate date, initially copied from start for convenience and editable before assignment.
- Expected end is read-only and automatically calculated one Philippine calendar year after induction, on both the form and trusted backend. February 29 becomes February 28 in the following non-leap year.
- New assignments explicitly use `termPolicy: until-turnover`. Passing the expected anniversary displays **Active — awaiting turnover** and does not revoke officer access.
- **Complete term** requires an administrator, recent authentication, reason and confirmation. It records the server's actual completion time in `actualEndsAtMs`, keeps the expected date, retains the reason, removes officer permissions and restores student role using the existing authentication synchronization/retry workflow.
- Account identity, password, Student ID, historical assignments and activity remain intact. Graduation, Dropped standing, suspension, removal and permission restrictions still apply.
- Completed terms display actual end and deactivation reason in historical assignments. Completed officers leave the current officer roster, as before.

## Existing assignments

No records are automatically migrated, and expired accounts are not automatically re-enabled. Existing assignments without the new policy retain their previous fixed cutoff.

An administrator can use **Adopt expected-end policy** on a current legacy assignment, enter the actual induction date and an authorization reference, then confirm. The confirmation explicitly explains that this can restore officer access after the old fixed cutoff. The server verifies current identity/assignment, account eligibility, office-slot ownership and recent administrator authentication. Completed, displaced, inactive, removed and ineligible accounts cannot be restored this way. The authorized reason, administrator and time are stored privately on the assignment. The original legacy cutoff is retained as historical data.

## Before and after

```js
// Before: one date was both the displayed end and an enforced cutoff.
a.status === 'active' && a.startsAtMs <= now && a.endsAtMs > now

// After: explicitly adopted assignments stay active until completion.
a.status === 'active' && a.startsAtMs <= now && a.actualEndsAtMs == null
  && (a.termPolicy === 'until-turnover' || a.endsAtMs > now)
```

The backend and Firestore rules enforce this same distinction. Assignment data remains server-owned and private. Older assignment-creation clients are rejected with a refresh instruction, rather than silently reinterpreting their fixed end dates.

## Modified files

- `server/officer-term.cjs`: shared backend active-term check and Philippine-calendar anniversary.
- `server/authorization.cjs`, `server/officer-history.cjs`: access checks, authoritative dates, audited legacy adoption, completion and roster fields.
- `firestore.rules`: expected-end policy with explicit actual-end/status checks; legacy cutoff retained.
- `shared/officer-history.js`, `usc-admin/admin-dashboard/officer-management.html`: form, read-only estimate, legacy confirmation, term/status/reason display; existing page shell and styles retained.
- `package.json`: includes term-policy regression tests in the officer suite.
- `tests/officer-term-policy.test.mjs`, `tests/officer-history.test.mjs`, `tests/officer-directory.test.mjs`, `tests/helpers/officer-history-fixture.cjs`: date, access, migration and lifecycle checks.
- `tests/officer-history.rules.test.mjs`: legacy expiry, adopted-policy access, server-only updates and completed-term revocation.
- `tests/browser/officer-management-only.cjs`, `tests/browser/officer-history.cjs`: form automation updated for read-only dates; management browser additionally checks leap day, delayed turnover, explicit adoption and actual completion/reason.
- `docs/officer-management-workflow.md`, `docs/officer-administration.md`, this review document: current behavior and deployment notes.

## Actual validation

- `npm run test:officer-history`: **41 passed, 0 failed**, including seven new date/policy/lifecycle tests.
- Hosted management, officer RBAC, announcement review, Needs Assessment and account-provisioning regression group: **36 passed, 0 failed**.
- `npm run test:syntax` passed; modified backend `.cjs` files passed `node --check`.
- `tests/browser/officer-management-only.cjs` passed against actual pages/controllers and management HTTP handlers with synthetic Auth/Firestore records. Covered automatic anniversary, separate induction, leap day, Philippine timezone, read-only estimate, overdue active assignment, legacy policy adoption, completion date/reason, same-UID promotion/return, existing directory operations and layouts at 1440, 768 and 390 pixels. No browser errors. Screenshots are local review artifacts, not a hosted Preview.
- Firestore emulator integration was attempted but **blocked**: emulator JAR download returned HTTP 403, `Domain forbidden`. Rules tests are prepared, but live rules behavior and emulator syntax validation cannot be claimed as passed.
- No live records, accounts, messages, production settings or backend services were changed. The older standalone officer-history browser script was updated for the read-only field but was not run; the current management browser supplied the validation above.

## Release coordination

Local changes require fresh user approval before pushing. The user retains the final merge action. Deploy and verify against isolated staging first, including Auth refresh, held-over officer access, turnover and rules integration. This change uses the existing hosted management service; no new Firebase or Supabase function is introduced.

The hosted backend/frontend and Firestore rules must be coordinated: old rules still enforce fixed cutoffs even when the new backend permits holdover, while old backend code ignores the adopted policy. Deploying production rules requires separate explicit authorization. A Git merge alone does not update Firestore rules. Do not describe the feature as fully active until both are verified.

For rollback, coordinate application and rules versions and review assignments already using the new policy. Returning to old fixed-cutoff rules can deny access to officers serving past their expected anniversary. Reverting code does not undo completed terms or restore an account's former permissions; reconcile authorized assignments explicitly and preserve history.
