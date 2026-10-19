# Bulk student account import

## Administrator workflow

Open **Admin Dashboard → User Directory → Import students**. Choose or drop a Google Forms CSV, XLS or XLSX export. Select the worksheet and match the six required fields: full name, six-digit student ID, institutional email, college/campus, program and year level. Header aliases are detected automatically. If the file omits college, program or year, choose explicit defaults. Program and college values must match the existing manual-registration catalog; year accepts 1–5 or the existing year labels. Other Google Forms answers are ignored rather than copied into account profiles.

Download the empty CSV template to see the field names. The parser runs locally in a worker with a 20-second timeout and a 5 MB / 1,000-student / 60-column limit; split larger exports. It does not execute spreadsheet formulas, HTML or macros. Keep leading-zero student IDs as text in spreadsheets. Preview calls the server and shows eligible, duplicate, existing and invalid records. Editing a column match or default invalidates the preview. Confirm once to create eligible students.

The client sends sequential batches of 25; each server invocation also processes accounts sequentially. Batches recheck administrator authority, recent authentication, duplicates and all field validation. For very large installations, preflight scans of legacy profile/masterlist/account collections add read cost: imports intentionally prioritize normalized duplicate detection over trusting incomplete historical indexes. No placeholder account creation or browser provisioning fallback is used.

Results distinguish created, skipped, invalid, failed and unconfirmed outcomes. Only successfully created accounts have credentials. **Download credentials CSV before closing**, and distribute it securely. The password-free import report contains every row's status and error. Passwords exist only in the immediate callable response and page memory; closing, changing account or leaving the page clears that view. Credentials are not retrievable on repeated imports. CSV exports escape spreadsheet formula prefixes; import ID columns as text to retain leading zeros.

If a connection fails during creation, the affected rows are **Unconfirmed**, because a server invocation may still have finished. Wait for it to finish, then run a fresh preview; existing accounts will be skipped without resetting their passwords. Use the existing administrator password reset workflow if an account was created but its response/credentials were lost. Never automatically retry creation to regenerate credentials.

## Backend and duplicate safety

`previewStudentAccountImport`, `importStudentAccounts` and `completeImportedStudentPasswordChange` use the existing Firebase project and `asia-southeast1` region. Import preview/creation require the trusted admin custom claim, an approved/active admin profile, verified administrator email and a sign-in within 30 minutes, matching existing privileged callable guards.

The backend checks normalized IDs, emails and the existing unique-name policy against legacy Firestore records, canonical claims and Firebase Authentication. Existing accounts are never migrated, enabled, reset, assigned roles or overwritten by this importer. A transaction reserves student ID, normalized full name and email before Auth creation, preventing concurrent imports from creating duplicate identities. It also shares the ID/name claim collections with manual registration. Auth users start disabled. Profiles, login aliases, directory/masterlist records, current election roster (if configured), identity claims and a preparation audit record commit atomically, then Auth is enabled. Completion is audited without request bodies or passwords. A completion-audit failure returns the created account with a warning, since account creation already succeeded.

Rollback deletes only this operation's new Auth UID and Firestore documents marked with its operation ID. If deletion/cleanup cannot be confirmed, the importer attempts to disable the account and keeps its identity reserved; maintainers must verify Auth state before cleanup. A process termination can also leave a reservation. Reservations deliberately do not auto-expire: automatic reuse could collide with an Auth account or a response lost in transit. For maintenance, inspect the operation ID in `student_id_claims`, `student_name_claims` and `student_import_email_claims`, compare the generated `import-…` Auth UID and its profile, and verify the invocation has ended. For a completed/enabled account, preserve it and use password reset if needed. For an incomplete disabled account, delete that Auth UID first, then remove only documents bearing the same `bulkImportOperationId` (including any profile, aliases, roster and `student_import_password_checks` entry). Preserve audit history and all unrelated documents. Re-preview afterward.

## Required initial password change

Imported students receive the existing student profile/eligibility structure. Their trusted `verifiedStudent` claim remains false until the password change completes, so legacy callable endpoints requiring that claim also reject temporary-password sessions. They start with `mustChangePassword: true` in both profile and trusted custom claims. Login and protected routes send them to `shared/required-password.html`. Firestore rules block student operations until both flags are cleared and prevent users from editing the flag themselves. Callable authentication also rejects tokens still requiring the change.

The completion callable updates only the signed-in imported student's Auth password, clears the requirement, audits the change, revokes refresh tokens and requires a fresh sign-in. It applies the existing 10–64 character policy. To reject reuse of the temporary password without storing plaintext, a random-salt scrypt verifier is kept in the server-only `student_import_password_checks` collection and deleted when the first change commits. No verifier, password, request body or credentials are written to audit logs. Existing manually created accounts and their password/reset workflows are unchanged.

## Deployment after approval

A **Vercel preview deploy publishes only the frontend**. The import cannot create real accounts until an authorized Firebase maintainer deploys the backend and rules. Do not deploy production until approval. From `SSU-USC-main/uscmod`, with Firebase CLI credentials for project `universitystudentcouncil-856cc` and a billing plan supporting Cloud Functions:

```sh
npm ci
npm --prefix functions install --ignore-scripts
npm run deploy:student-import -- --project universitystudentcouncil-856cc
```

This targets only the three new callables and Firestore rules. Review the rules diff before publishing. Configure App Check through the project's existing `USC_ENFORCE_APP_CHECK` setting and existing Firebase setup; do not weaken access checks to resolve errors. Verify the functions are in `asia-southeast1` and have callable invocation/CORS access compatible with Firebase clients. No private service-account key belongs in the browser or Vercel static files.

`requireAuth` also rejects a token marked `mustChangePassword`. That shared guard takes effect for already deployed functions only when those functions are subsequently redeployed; deploying just the three new callables does not update existing function revisions. The updated Firestore rules enforce the requirement for browser student operations immediately after rules publication. If existing Cloud Functions are used for student operations in your production installation, review and redeploy those existing endpoints with the updated guard as part of the approved rollout. Do not assume new callable deployment updates every old function.

After approving and merging the PR, Vercel publishes the frontend automatically. Verify with designated test students: preview creates nothing; duplicates preserve existing users; a created account can use its student ID/email and temporary password; it must change to a different password before accessing the dashboard; old credentials then fail; credentials exports include only created accounts and reports never include passwords.

## Development validation

```sh
npm run test:student-import
npm run test:student-import-integration
npm run test:provisioning-rules
npm run test:syntax
```

Integration tests use Auth and Firestore emulators with a demo project only. They exercise actual Auth sign-in and password changes, normalized legacy duplicates, concurrent requests, protected targets, authorization, rollback, partial failure and rules enforcement. The program catalog snapshot in `functions/ssu-programs.json` is checked against the existing registration catalog; update both together when programs change.
