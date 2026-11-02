# Editable election schedules and Candidate Review button layout

## Behavior

The saved schedule now offers **Edit Schedule** and **Extend Voting Time**. Editing saves changes to the same permanent election ID; the editor no longer describes saving as creating a replacement schedule. Candidates, ballots, turnout, review completion and official results are not reset.

Extend Voting Time focuses the closing-time field and protects the other phase inputs. The new time must be later than the old closing time. If it overlaps result publication, the result window moves to the new voting end while retaining its existing duration; the adjusted dates are displayed before a confirmation. General schedule editing retains full date controls. The extension flow hides the unrelated Delete Schedule action.

Both browser/Spark and optional Cloud Function saves now read and commit in a transaction, check the editor's schedule version, and reject an election that has been finalized, had results published, or been archived. They preserve existing review/finalization fields instead of rewriting them. The schedule version and audit record are saved with the update; stale editors must reload. The browser audit includes before/after dates. The student lifecycle uses the same saved schedule, so normal one-vote restrictions remain unchanged.

Firestore rules enforce valid phase windows and prevent rescheduling officially finalized/published/archived elections. No production rules have been deployed by this task.

Candidate Review actions now have a dedicated row for View, separate Edit/Remove hit areas, 12px gaps, consistent 44px minimum heights, wrapping and visible keyboard focus. At phone widths the actions stack, so they do not merge or overlap. These are layout changes only; candidate permissions, confirmation and vote-history protections are unchanged.

## Files

- `shared/election-extension.js`: pure targeted-extension calculation.
- `shared/security-client.js`: atomic browser saves, version checking, context version and audit dates.
- `functions/index.js`: matching optional server transaction, version and publication guards.
- `firestore.rules`: finalization and date-order protection for schedule edits.
- `usc-admin/elections/js/elections.js`: clear update flow, dedicated extension action, date preview, confirmation and fixed ID.
- `usc-admin/elections/elections.html`: extension button, revised labels and asset versions.
- `usc-admin/elections/css/elections-modern.css`: responsive Candidate Review action spacing.
- `tests/election-schedule-update.test.mjs`: extension/date preservation, old-editor rejection, concurrent finalization, audit failure, history preservation and browser/cloud compatibility.
- `tests/officer-election-saved-schedule.test.mjs`: updated editor contract.
- `tests/election-candidate-removal.rules.test.mjs`: additional real-emulator schedule permission and date-lock checks; existing removal checks retained.
- `package.json`: include schedule tests in standard validation.
- This review note.

Local sample-data layout captures: [desktop](previews/candidate-review-desktop.png) and [phone](previews/candidate-review-mobile.png). These are screenshots for visual review, not an interactive staging site.

## Validation

- `npm test`: 185 passed, 0 failed, 0 skipped.
- Isolated local Firestore emulator (`demo-ssu-candidate-removal`): 15 passed, 0 failed, 0 skipped, including all existing candidate removal cases.
- Browser layout check at 1280px and 360px: all View/Edit/Remove buttons have non-overlapping bounds, fit the viewport, and are at least 44px high.
- Browser extension check with synthetic data in Asia/Manila timezone: election ID stays disabled, only voting end is editable in extension mode, and a conflicting result window moves later while preserving duration.
- Syntax and diff-whitespace checks passed.

Browser/UI validation used local synthetic data and blocked external requests. No production student records, votes, Firebase rules or other backend settings were changed. Live authenticated preview writes remain unverified until isolated staging is available.

## Deployment and rollback

Apply the reviewed Firestore rules to staging before functional review. The current browser runtime uses the matched frontend security client; if optional Cloud Functions mode is used, deploy its matching schedule/context changes to staging too. No new index, database migration or secret is required. Existing production permission errors cannot be bypassed by this frontend change; deployed rules/permissions still need verification.

Only push the development branch and create a draft PR/Preview. The user manually merges after review. Production backend/rules changes need separate explicit authorization; do not deploy them automatically. Restore a previous approved frontend/backend pair through an authorized revert if needed. Never delete ballots, candidates, voter status or audits to roll back a schedule editor.
