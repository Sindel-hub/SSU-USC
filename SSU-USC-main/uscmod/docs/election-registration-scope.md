# Election-specific candidate registration

## Cause

The application reads already use `elections/{electionId}/applications/{uid}`. The schedule editor reused a predictable yearly ID, and “Create New Schedule” behaved like editing when a schedule existed. Deleting a schedule preserved its election document/applications (correctly), but recreating that ID reactivated the same registrations. A new schedule was therefore not a new election namespace.

## Behavior

New elections generate UUID-suffixed IDs. Create mode is distinct from edit mode; backend schedule saves reject existing IDs for new elections, deleted IDs, and historical-ID reactivation. Current-election edits retain candidates/votes. Existing archive-before-switch lifecycle protections remain in place.

Applications are created at the deterministic current-election/UID path, with explicit electionId, applicantUid and studentId. Browser and callable submissions pin the displayed election ID and transactionally recheck the active pointer, election lifecycle, and existing application. Database rules require the current pointer, correct path identity and registration window, and deny student updates. Concurrent same-election requests cannot create duplicates. Submission does not check unrelated historical elections.

Student refreshes clear old application/draft state on ID changes and reject stale asynchronous reads. Existing status remains accessible after registration closes; the status view refreshes with officer decisions. Officer current-election queries remain scoped, while a new read-only history dialog lets officers select older elections without activating or editing them. Review/remove-application requests include the originating election ID so a changed active pointer cannot redirect a stale officer action.

## Legacy records and data integrity

No production records were inspected or modified. No applications, candidates, votes, or historical records are deleted by this fix. An application without an electionId remains associated with its verified parent election path; the student read normalizes that identity in memory only. Explicit conflicting IDs fail closed for administrator review. Unscoped global legacy documents are not assigned to any new election.

If an election was already reused and histories were mixed before this fix, dates alone do not prove which cycle owns each record. Review its audit logs and original records before any targeted migration. Do not clear applications to restore eligibility. Start the next cycle with a fresh ID; preserve the old namespace as history.

## Deployment

No production backend deployment is authorized. The preview uses existing service configuration. Frontend IDs, scoping and browser transactions can be reviewed there; isolated demo Firestore emulator tests verify the tightened rules. Before deployment, apply the new rules to isolated staging and test the matching client. If callable mode is used, deploy the matching functions to staging too. Production rule/function rollout requires separate explicit approval; the PR is left for manual merge. No indexes or automatic data migration are required. Legacy clients lacking electionId in submissions must refresh after the coordinated rollout.

## Verification

`npm test` includes unique-ID generation, create-versus-edit mode and stale registration read regression tests. `npm run test:registration-scope-rules` runs against a demo Firestore emulator with synthetic students/officers/elections: A→B independence, new applicants, concurrent duplicate prevention, identity checks, inactive elections, and separate officer lists. Browser fixtures verify student landing/status navigation and independent historical list selection/cleanup. No live student records are used.
