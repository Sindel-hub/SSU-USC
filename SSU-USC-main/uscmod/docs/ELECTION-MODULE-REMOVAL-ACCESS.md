# Election module access: approved candidate removal

Officers explicitly assigned `elections.view` can remove an approved candidate without receiving application-review or profile-edit authority. Existing `elections.review` officers and administrators retain their prior removal permission. Generic officer read-only navigation without an assigned election permission does not grant removal.

The UI exposes Remove on the approved application card, candidate management panel and preview dialog. The entire application card is no longer locked behind review permission; Approve/Reject still require review permission. Pending application deletion and profile editing retain their existing review restrictions.

Removal is available before, during and after voting. Confirmation remains required. The candidate is soft-removed, and student candidate lists/ballots omit it. Original approval records, votes, official results and immutable actor/timestamp/before-after audit records are retained. No election reset or physical candidate deletion is performed.

The browser and optional Cloud Functions accept either module access or existing review access for candidate removal. Firestore restricts module-only writes to the removed flag, update/audit metadata and the integrity snapshot. Module-only audit creation must be tied to the same candidate write. It cannot be used to edit names/positions or create orphan removal events.

## This revision's files

- `usc-admin/elections/js/elections.js`: distinct removal permission, action-level review controls.
- `usc-admin/elections/elections.html`: remove the enclosing review-only card lock; version the script.
- `shared/security-client.js`: accept either assigned permission for removal and include audit target identifiers.
- `functions/index.js`: mirror the same permission alternatives for the optional server runtime.
- `firestore.rules`: restrict module-only removals and require linked immutable audits.
- `tests/election-candidate-management.test.mjs`: module-only success, edit denial, unassigned-officer denial, UI routing and server permission regression tests.
- `tests/officer-rbac.test.mjs`: ensure review controls remain restricted while their enclosing card is not locked.
- `tests/election-candidate-removal.rules.test.mjs`: actual emulator tests for all election stages, audit integrity, edit denial, physical-delete denial, reviewer compatibility and unrelated-candidate protection.
- `package.json`: emulator-only test command with an explicit demo project.
- This review note.

## Validation

`npm test`: 152 passed, 0 failed, 0 skipped.

Actual local Firestore emulator: 10 passed, 0 failed, 0 skipped. The tests used synthetic records in `demo-ssu-candidate-removal`; no production records or credentials were used. Test dependencies were installed outside the repository; no dependency declarations or lockfiles were changed.

With normal development dependencies installed, use `npm run test:candidate-removal-rules`. It starts only the local Firestore emulator with an explicit demo project. The temporary test setup used a separate port/config and external dependency directory.

## Deployment

The updated Firestore rules must be reviewed and deployed to isolated staging before this permission change can be verified interactively. A frontend-only Vercel build does not grant the underlying removal permission. Optional Cloud Functions deployments must also use the updated authorization if that runtime is enabled. No production backend update is authorized by this change.

Production remains behind PR review and the user's explicit APPROVE AND DEPLOY command for the exact reviewed Preview. Restore the previous frontend/rules pair through an authorized rollback if needed; do not erase candidate history, votes or audits. The wider development branch includes the previously prepared Gmail and election changes, whose staging requirements remain in DEPLOYMENT-PREPARATION.md.
