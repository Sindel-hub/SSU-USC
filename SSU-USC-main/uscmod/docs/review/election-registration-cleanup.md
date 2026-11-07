Election candidacy cleanup — review and backend rollout

User-approved scope: clear candidate registrations/active candidate entries; preserve ballots, voter participation, results, voter roster and student login/profile records. Historical candidate identity snapshots and immutable audits remain because retained votes must remain interpretable. This is removal from active candidate/student/management views, not erasure of vote history.

Root causes:
- Schedule deletion only marked scheduleDeleted and removed the active pointer; it retained applications and candidates.
- Candidate removal/dismissal retained the approved application that the Student page uses for Already Registered.
- Reusing the same election ID could therefore revive old applications.

New behavior:
1. Schedule deletion is transactional, rechecks protected states, closes registration and records a cleanup operation ID before any purge. Approved/active candidates are audited, removed and hidden. Applications are physically deleted in groups of 200, with transactional reads of the same operation ID. Another active election and its pointer are untouched.
2. Cleanup is retryable after failure and resumes before a deleted ID is reactivated. Older cleanup operations cannot erase a newer generation. The server and browser runtimes implement equivalent cleanup; no account/ballot/participation resets occur.
3. Individual candidate removal/dismissal deletes applications linked by candidateId in the same audited transaction. Pending application removal keeps its existing reviewer permission. Candidate identities already referenced by votes remain as hidden historical records.
4. Older approved applications whose candidate is missing/removed can be cleared during the authenticated Student refresh. Rules limit self-cleanup to that user's own stale approved application. Live approvals and other users' records cannot be cleared. The Student action returns to Register as Candidate only when registration is open and the account remains eligible.
5. Officer refresh performs a read-only check of already-reopened legacy schedules and offers a counted, explicitly confirmed one-time cleanup: only submissions timestamped on/before the recorded scheduleDeletedAt are removed. Newer registrations stay. Unknown/missing submission dates are not guessed at. Full schedule deletion still clears every application regardless of status/date.
6. Review/registration creates stop as soon as schedule deletion begins. Review completion cannot reactivate a deleted server-side schedule. Incomplete cleanup cannot be activated by older clients. Failed deletion controls re-enable for retry; a successful deletion is not misreported as failed solely because refreshing the dashboard failed.

Reusing an election ID resets candidacy only, as requested. Existing voted status intentionally remains. Use a distinct election ID for a genuinely new voting cycle.

Authorization/rules changes:
- Retain the reviewed missing-lifecycle-flag compatibility fix from PR #61 (already manually applied by the user to live rules).
- Permit module-authorized cleanup of applications under a deleted schedule, and narrowly aged pre-deletion submissions during legacy repair.
- Permit deleting an approved application atomically with its linked candidate's audited removal, and permit idempotent dismissal retries.
- Permit reading only the candidate linked to one's own approved application so pre-publication self-repair works; this does not expose other candidates or applications.
- Preserve existing module/reviewer/admin permissions, finalization/archiving restrictions, candidacy approval and date-window checks. No new officer roles or global access grant.

Validation:
- Maintained npm suite and new runtime regressions cover over 1,000 registrations, linked application deletion, another active election, safe retry, cleanup generations, optional Cloud cleanup, stale Student state, the actual registration button text, same-ID reuse and selective legacy repair.
- Firestore emulator executes the real browser transaction functions against real SDK calls using synthetic demo accounts. Tests cover multi-batch purge, fresh re-registration, closed registration after deletion, stale-vs-live approval deletion, private candidate isolation, incomplete activation rejection, old-ID reuse and preservation of fresh legacy-cycle records. Existing candidate-removal/account-protection regressions run alongside them.

Deployment gate:
Vercel deploys frontend files only. The new cleanup requires the reviewed Firestore rules. If optional Cloud Functions mode is used, its updated handlers must also be deployed to isolated staging first. No Firebase rules, functions, production records, accounts or credentials were changed remotely during this work. Frontend preview uses existing service configuration; do not use live records to test deletion.

Before release, compare the full reviewed rules with the currently deployed file rather than blindly replacing unrelated policies. Validate on an approved isolated staging Firebase project, obtain explicit backend deployment authorization, then deploy the approved rules before releasing clients that invoke cleanup. For optional callable mode, coordinate saveElectionSchedule, deleteElectionSchedule, repairElectionRegistrations, removeElectionCandidate, dismissElectionCandidate, submitCandidateApplication and reviewCandidateApplication. No indexes/migrations or roster reset is needed.

After cleanup deletes application records, reverting code cannot restore them. Preserve an authorized staging/production backup before an approved rollout if operational rollback of deleted registrations is required. Roll back presentation/handlers separately; never restore or reset ballots, participation or accounts as a side effect.
