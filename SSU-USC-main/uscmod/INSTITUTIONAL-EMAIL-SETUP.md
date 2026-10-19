# Optional institutional email for manual accounts

Manual student and officer creation accepts a blank institutional email. The
existing password generator and administrator-only browser provisioner remain in
use. A blank address produces `institutionalEmail: null`, an empty contact `email`,
and a unique `<six-digit-id>@student.ssu-usc.local` Firebase Authentication address.
The internal address is a login identifier, never an institutional inbox. Login
slips, the directory, and profile settings show **Not Linked** instead.

Student ID login continues to resolve `login_aliases/id_<studentId>`. Institutional
login resolves the existing `email_<sha256(normalizedEmail)>` alias. Linking adds
that alias to the same Firebase Authentication address, UID, password, and roles;
it never creates, renames, or migrates an Authentication account.

## Before enabling in production

The Vercel preview only publishes website files. It does not deploy security rules
or Supabase functions. Review and approve the PR and backend updates separately.

1. Publish the reviewed `firestore.rules` to the existing Firebase project. Alias
   writes remain administrator-only, with ownership checks on updates. Pending
   email-verification records are inaccessible to all browser clients.
2. Deploy **only the existing `usc-email` Edge Function**, including its updated
   shared helper and `institutional-accounts.mjs`:
   `supabase functions deploy usc-email --no-verify-jwt`.
   The existing `supabase/config.toml` already disables the Supabase JWT gate;
   Google validates Firebase ID tokens inside the function before privileged work.
3. Reuse the existing email-service configuration: `FIREBASE_PROJECT_ID`,
   `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `PORTAL_URL`,
   `RESEND_API_KEY`, `EMAIL_FROM`, and the existing Supabase service credential.
   Enter secrets through Supabase settings, never website files or GitHub.
   The Firebase service account needs permission to read/write the relevant
   Firestore documents, look up Firebase Auth users, and update passwords.
   Existing deployments with read-only Firebase IAM permissions need those
   permissions adjusted by the project owner.
4. Set `PORTAL_URL` to the approved website origin that serves
   `/email/verify-institutional.html`. Verification links use this configured
   origin, not untrusted request headers. Preview tests can use an approved test
   environment; do not repoint a production email service merely to test a PR.
5. Merge/deploy the website only after review. Run the acceptance checks below
   with designated test accounts before enabling the flow for real students.

No new Firebase Cloud Functions, paid Firebase services, SQL tables, spreadsheet
processing, or bulk operations are required. No bulk-import code or deployment is
part of this change. Existing `resolveSchoolLoginIdentifier` and
`adminResetUserPassword` callables have small compatibility/display corrections;
the browser flow uses Firestore aliases and the existing email service without
requiring those callable updates. If those callables are already in use, update
only those two through the project's existing approved deployment process.

The shared email helper's invalid npm import was corrected to
`npm:@supabase/supabase-js@2.55.0`, required to build the existing service.

## Student workflow and security

Open **Profile → Account Settings**, enter an institutional address and the current
password, and send a verification link. The permitted domain is exactly
`@ssu.edu.ph`. No arbitrary domains or lookalike suffixes are accepted. Additional
university domains require an explicit allowlist change in both validators.

The service requires a recently authenticated, approved, active student/officer
account. It emails a random, single-use, 24-hour token; only its SHA-256 hash is
stored in a server-only Firestore record. The student must sign in to the same
account and explicitly confirm the link. A new request invalidates the previous
token. Requests are limited to one per minute and five pending requests per day.

Confirmation rechecks Auth email ownership, alias ownership, and Student ID
records. A preconditioned atomic Firestore commit binds the verified email,
updates identity metadata, preserves the ID alias, consumes the token, and records
an audit entry. Conflicting/concurrent writes fail rather than overwriting
another account. Pending email is never marked verified.

New manual accounts with an entered email can immediately use Student ID login;
email login requires verified mailbox ownership. Existing accounts without the new
verification field retain their existing login behavior. Firebase's existing
verified-email flow remains compatible for officer accounts whose Auth address
already equals their institutional email.

## Password recovery without an inbox

Administrators can use **User Directory → Reset password**. The existing callable
is preserved; if unavailable, accounts with internal Auth addresses use a trusted
single-account reset action in the existing `usc-email` service. The service
requires the trusted admin custom claim, an approved active admin profile, and
recent authentication. It updates Firebase Auth, revokes older sessions, and
returns a generated temporary password only to that administrator for the existing
private credential viewer/print workflow. Passwords are never written to Firestore
or audit logs. Reset metadata failures are reported separately after a successful
Auth change so the administrator can still deliver the new password.

Do not send Firebase reset emails to a synthetic address or create a replacement
account. The existing verified personal-Gmail recovery flow remains available and
continues to resolve the actual Firebase Auth account.

## Acceptance checks

- Create a student and officer individually with email left blank; confirm required
  academic/role fields and generated passwords still work, ID duplicates fail, and
  no internal address appears in the login slip or profile.
- Sign in by Student ID, request a university-email link, confirm in the same
  signed-in account, and sign in with either identifier using the same password.
- Check the UID, roles, permissions, past records, and Student ID remain unchanged.
- Reject invalid domains, emails owned by other accounts, wrong-account links,
  expired/replaced/replayed tokens, and unauthorized alias/profile changes.
- Issue a temporary password from the directory for an account without an email;
  ensure old credentials stop working and no password appears in Firestore.

Local validation commands (no production data):

```sh
node --test tests/institutional-accounts.test.mjs tests/institutional-firebase-adapter.test.mjs
firebase emulators:exec --project demo-ssu-registration --only firestore,auth "node --test --test-concurrency=1 tests/account-provisioning.rules.test.mjs tests/optional-email-login.emulator.test.mjs"
node --test tests/js-syntax.test.mjs tests/email-service.test.mjs tests/officer-gmail-profile.test.mjs tests/account-duplicate-identity-guard.test.mjs tests/account-provisioning-rbac-regression.test.mjs tests/admin-password-reset-browser-fallback.test.mjs
deno check --no-lock --node-modules-dir=none supabase/functions/usc-email/index.ts
```
