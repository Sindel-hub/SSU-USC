Election schedule permissions repair

Reproduction: an approved active Vice President with the existing elections.view module permission can create a complete election, current pointer and audit entry atomically. Updating a legacy election without archived/finalized/resultsPublished is rejected by the previous rules. Emulator diagnostics include evaluation failures and an expression-limit message along the failing authorization path. The same test passes after using false defaults for absent lifecycle flags and removing repeated elections.view checks already guaranteed by the outer update gate.

No extra role or officer permission is granted. Date chronology, review/results permissions, canvasser finalization, administrator archiving and finalized/published/archived protections remain. The fix does not rewrite or backfill election or student records.

The schedule editor also distinguishes a successful save followed by a dashboard-refresh failure from a denied save. A refresh error leaves a visible saved confirmation and instructions to reload, instead of reporting that the schedule transaction failed.

Tests:
- Before: new schedule and current-record update passed; the legacy-record update failed (8 pass, 1 fail in the initial focused suite).
- After: 33 emulator regressions pass across election-schedule-permissions.rules.test.mjs and election-candidate-removal.rules.test.mjs, with synthetic identities and demo projects only. Includes a position-default VP, no custom auth role claim, unauthorized-user rejection with no partial writes, chronology and protected-state rejection.
- npm test: 375 pass, including transaction preservation and save-versus-refresh error handling.

Preview/backend deployment limitation:
Vercel deploys the frontend only. No Firebase rules or production records have been deployed/modified. Live rules and the affected election document were not accessible for read-only inspection, so this reproduced defect is not proof of the exact deployed-record state. If the screenshot is a genuinely new election rather than updating an existing/legacy ID, deployed-rule drift or another live-profile discrepancy still needs verification.

Before release, an authorized operator must inspect the affected election ID and compare deployed Firebase rules to the reviewed version. Validate the fix using an approved isolated staging Firebase project. Obtain separate explicit production-backend deployment authorization, preserve a rollback copy of deployed rules, and deploy only the reviewed rules after checking the full rules diff against that copy. Do not blindly deploy other pending rules, indexes or functions. The existing main branch includes other backend rule changes that may not yet be live.

No account permission escalation or record reset is needed for this fix. No backend deployment is authorized by this review preview.
