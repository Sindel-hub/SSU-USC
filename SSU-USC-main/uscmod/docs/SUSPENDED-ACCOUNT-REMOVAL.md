# Suspended-account removal and verified Gmail recovery

Password recovery now calls the existing public `usc-email` recover action rather than asking Firebase to find the personal Gmail as its primary login. No backend deployment is required for that recovery-page correction. Delivery remains conditional on a verified recovery-enabled Gmail, configured provider, backend permissions and sending limits; public responses must not reveal account existence or claim confirmed delivery.

## Account removal

Only a recently signed-in trusted administrator with an approved active profile may remove another suspended, inactive student or officer. The confirmation explicitly explains that removal hides the directory account, disables Firebase sign-in/revokes refresh sessions and detaches the personal Gmail. It does not erase historical records or permanently delete the Firebase UID. Native Firebase login addresses remain reserved; this is account archival, not identity reuse or a personal-data erasure tool.

The service first writes a pending marker and immutable audit entry with a Firestore version precondition. It disables Firebase Authentication, deletes only the target UID's student_email_accounts row (including pending verification tokens/preferences), then commits the removed marker and completion audit together. Historical email delivery logs, complaints, ballots, results and other profiles remain. The directory hides only completed removals. Partial failures remain suspended and visible with Retry removal; retry is idempotent. Cross-service steps are not a single database transaction and must not be reported as complete before final commit.

Rules prevent browser updates to pending/removed profiles or forged removal markers. Both browser and callable administrator update adapters reject those profiles; callable updates use a document-version precondition to reject concurrent edits. Suspension rules also allow an Active/Enrolled account to become inactive when suspended.

## Staging and release order

No production resources were changed. No isolated staging projects are currently configured. Do not merge the account-removal UI into production before its backend dependencies are available and reviewed.

1. Configure separate staging Firebase/Supabase projects and connect the development Preview to them; use synthetic accounts only. Keep production IDs, secrets and records unchanged.
2. Deploy the reviewed Firestore rules to staging first. Deploy the updated usc-email Edge Function (including account-removal.mjs and _shared helper). Its existing service account needs Firebase account-update and Firestore commit permissions; its Supabase service role needs target-row deletion permission. No SQL migration or paid service is required by this change.
3. If callable account-management mode is used, deploy the reviewed adminUpdateUser concurrency guard to staging as well.
4. Verify student and officer suspension/removal, confirmation cancellation, protected administrators, stale login rejection, partial-failure retry, disabled sign-in, detached Gmail/tokens, preserved historical data/audits and unrelated account isolation. Exercise recovery using a staging mailbox and synthetic existing Firebase UID; verify the reset changes that account's password and retains role/UID.
5. Review the actual latest Preview and exact commit. The user manually merges. Production rules, Edge Function and callable updates require separate explicit authorization and the same coordinated order before frontend release.

## Recovery and rollback

Keep the previous frontend/Edge Function versions and reviewed rules available. Revert the frontend to remove the new action if necessary; avoid blindly rolling back the marker-protection rules while pending removals exist. Never auto-enable a removed account or recreate its Gmail mapping as rollback: it may have been intentionally removed or the Gmail may already belong elsewhere. A failed pending operation is safely retried after restoring backend access. Restoring an archived account requires a separate administrator-approved support procedure. Historical records and audit entries must remain unchanged.
