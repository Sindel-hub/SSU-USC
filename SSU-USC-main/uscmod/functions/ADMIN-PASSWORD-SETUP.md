# Administrator-chosen passwords

In Admin Dashboard → User Directory, search for a student or officer, open the account, and choose **Set password**. Enter and confirm the chosen password, then select **Save password**. The existing **Reset password** recovery flow remains available separately.

The new password follows the same policy as Profile → Change Password: 10–64 characters, including uppercase, lowercase, a digit, and a symbol. The value is sent unchanged to Firebase Authentication. It is never returned by the callable, placed in local/session storage, or written to Firestore/audit data. Closing the editor clears both fields. Refresh tokens are revoked after a successful change; already-issued ID tokens retain Firebase's normal validity until expiry unless a service explicitly checks revocation.

## Required backend publishing

The Vercel GitHub preview publishes the interface only. An authorized maintainer must publish `adminSetUserPassword` to the same Firebase project, in `asia-southeast1`, before live saves work. The callable uses the existing trusted-admin role, approved/active administrator profile, verified admin email, and recent-sign-in requirements. It cannot change administrator passwords. It does not use the browser recovery-email fallback.

After approval, from `SSU-USC-main/uscmod`, using an authenticated Firebase CLI with deployment permission:

```sh
npm run deploy:admin-password -- --project universitystudentcouncil-856cc
```

This deploys only `functions:adminSetUserPassword`; it does not publish unrelated functions, rules, or Vercel production. The callable uses Firebase's managed Admin SDK credentials, with no privileged key in the browser. Address any deployment prerequisites reported by the Firebase CLI before publishing.

Verify with a designated test student/officer account: confirm the selected account, set a chosen password, check the success message, then sign in as that account with the chosen password and confirm the previous password is rejected. Do not use another person's account for deployment checks.

## If Save password reports an unavailable service

A Vercel preview deploy does not deploy Firebase functions. Check Firebase Console → Functions for `adminSetUserPassword` in `asia-southeast1` in project `universitystudentcouncil-856cc`. If absent, an authorized maintainer must run the command above after approval. A frontend-only change cannot securely replace that backend.

If the function is present, inspect the failed callable request in the browser Network panel and the function's Firebase logs. Check its deployed region, callable access/CORS configuration, and App Check settings; a generic Firebase `internal` error alone does not identify the cause. Do not include passwords or request bodies in screenshots or logs. A stale session requires signing in again; the administrator must also have a verified email and an approved, active admin profile. Do not weaken those checks to resolve deployment failures.

## Development checks

```sh
npm run test:admin-password
npm run test:admin-password-integration
```

The integration script starts Authentication and Firestore emulators against a demo project. It cannot run without both emulator hosts. It verifies actual old/new password sign-in, exact input preservation, refresh-token revocation, unchanged account role/status, and credential-free metadata and audit records.
