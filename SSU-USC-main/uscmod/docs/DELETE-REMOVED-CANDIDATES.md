# Delete removed candidate cards

Remove first hides a candidate from student lists and ballots. Delete from Review then confirms and persists managementHidden on that removed candidate. Application and candidate records, resultIdentity, ballots, official results and audit logs remain intact. No restore button is introduced.

Deploy the reviewed Firestore rules to isolated staging before testing the browser adapter. Callable mode additionally requires the new dismissElectionCandidate function. Configure the preview to use staging Firebase/Supabase; no staging project currently exists. Never exercise writes against production to verify this feature. Existing production permission errors require separately reviewing and authorizing production rule deployment.

Verify with synthetic staging records: remove, cancel deletion, confirm deletion, reload, check officer card disappears, student remains excluded and historical results remain identical. Confirm unauthorized accounts cannot dismiss or physically delete records.

Release only after user review and manual PR merge, coordinating separately authorized backend deployment before frontend release. Roll back frontend to its previous deployment to display dismissed cards again; retain audit logs and records. Do not delete historical data during rollback.

Local validation: npm test (190 passed), Firestore emulator (17 passed), Chromium desktop/mobile button layout checks (1280/360px).
