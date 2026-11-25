# Officer account workflow

## Changes made

- Registration Queue is removed from admin navigation and dashboard shortcuts. Existing `queue.html` bookmarks redirect to User Directory. No profiles or pending accounts are deleted; approval, suspension, verification, recovery and account removal remain in User Directory.
- User Directory retains its Register student account shortcut. Officer creation is replaced by promotion through Officer Management. Its role, position, effective date and permission controls display the current assignment without allowing edits. Bulk role changes, office-wide permission copying, and automatic legacy-permission writes are retired.
- Officer Management is the sole application path for officer assignment. Find the existing account by exact Student ID, select its supported office and approved permissions, specify its administration, authorization reference and the term start date, and create the assignment. Expected end is March of the academic year’s ending year, independent of account creation or term-start anniversary. Directory's **Manage officer term** action carries the Student ID to this lookup.
- The same Firebase UID, password, linked identity and Student ID are retained. Completing a term restores student role/claims and removes officer permissions while preserving the assignment and activity history. Student standing and suspension restrictions remain authoritative.
- Manual officer-registration bookmarks redirect to Officer Management. The old provisioning export now fails before creating an Auth identity or writing records. Account replacement cannot create an officer role.
- Browser account updates, the legacy callable and Firestore rules reject direct role/office/permission changes, including profiles without an assignment history. Directory account writes omit assignment fields so ordinary edits cannot replace them.

## Before and after

| Before | After |
| --- | --- |
| Registration Queue promotes accounts directly | Queue redirects to User Directory; promotion uses Officer Management |
| User Directory provides student/officer creation shortcuts | Directory retains student registration and provides Officer Management access |
| Directory can change roles, office and permissions | Assignment fields are read-only; account-status actions remain |
| Manual officer creation issues a separate identity | An approved active student account receives a dated officer assignment |
| Directory permission defaults may be persisted automatically | Merely viewing the directory does not rewrite officer permissions |

The application keeps its existing page shell, modal, typography and styles. No CSS redesign is included.

## Existing records and term expiry

No data migration or deletion is performed. Existing officers retain their current account and access. An administrator can record a supported appointment on an existing officer account through Officer Management; assignment history must be completed before a subsequent assignment replaces it.

New assignments use an expected March rather than an automatic expiry cutoff. Administrators use **Complete term** to record the actual end/reason, restore the student role and synchronize authentication. Legacy fixed-cutoff assignments retain expiry unless an administrator explicitly uses **Adopt expected-end policy** using the recorded term start and an authorization reference. No scheduler is added. Completion or policy adoption does not override a graduated, dropped or suspended account's access restriction. See [Expected and actual term review](officer-term-policy-review.md) for the current behavior and validation.

## Validation

- 133 targeted automated tests passed: assignment authorization, permission boundaries, same-account promotion/completion, credentials/history retention, duplicate assignments, expiry, student activation/import/graduation, replacement restrictions, callable/browser guards and retired navigation.
- Browser flow passed against the real pages/controllers and management HTTP handlers, with synthetic Firebase records/Auth and mocked directory transport. Verified redirects, read-only assignment fields, account edits that omit role fields, exact Student ID handoff, promotion/completion on the same UID, and layouts at 1440, 768 and 390 pixels. No browser errors or external production requests.
- JavaScript syntax and backend-free routing checks passed.
- Full `npm test` reaches seven existing login fixture failures in `verified-gmail-login.test.mjs` (missing `URLSearchParams` in its VM context), reproduced previously on unchanged main. The separately run auth-regression group reports 175 passed / 7 failed. No login files were modified.
- Firestore emulator execution is blocked: emulator download returns HTTP 403, `Domain forbidden`. Updated rules tests are included but cannot be reported as passing. Live staging and production services have not been tested or modified.

## Deployment requirements after review

1. Push only after explicit approval of this change. The user merges the pull request manually.
2. Validate the rules suite in an environment able to download the Firestore emulator: `npm run test:provisioning-rules`, `npm run test:officer-history-rules`.
3. Verify the frontend and management endpoints against isolated staging Firebase services. Existing project connections and secrets are unchanged.
4. Coordinate the frontend/hosted management update with the reviewed Firestore rules (`firestore.rules`) and, if used, the legacy `adminUpdateUser` Cloud Function. Frontend deployment alone does not enforce the new database restrictions against older clients. Deploying rules first intentionally prevents older directory/officer-creation clients from changing roles; deploy the frontend promptly afterward.
5. Production rules or Functions deployment requires separate explicit authorization. No production backend deployment is performed by this change.

Rollback the frontend, hosted management code and rules together if necessary; retained accounts and immutable assignment records need no rollback or deletion.

## Modified files

- `docs/officer-management-workflow.md`
- `firestore.rules`
- `functions/index.js`
- `package.json`
- `server/account-replacement.cjs`
- `shared/browser-provisioning.js`
- `shared/officer-history.js`
- `shared/security-client.js`
- `tests/account-provisioning-rbac-regression.test.mjs`
- `tests/account-provisioning.rules.test.mjs`
- `tests/account-replacement.test.mjs`
- `tests/admin-queue-metrics-ui.test.mjs`
- `tests/admin-user-directory-provision-height.test.mjs`
- `tests/browser/officer-management-only.cjs`
- `tests/capstone-browser-mode.test.mjs`
- `tests/navigation-profile-scroll.test.mjs`
- `tests/officer-history.test.mjs`
- `tests/officer-management-access.test.mjs`
- `tests/officer-rbac.test.mjs`
- `tests/static-project.test.mjs`
- `tests/student-officer-slip-modal.test.mjs`
- `usc-admin/admin-dashboard/admin-dashboard.html`
- `usc-admin/admin-dashboard/audit.html`
- `usc-admin/admin-dashboard/js/admin-audit.js`
- `usc-admin/admin-dashboard/js/admin-core.js`
- `usc-admin/admin-dashboard/js/admin-dashboard.js`
- `usc-admin/admin-dashboard/js/admin-users.js`
- `usc-admin/admin-dashboard/officer-management.html`
- `usc-admin/admin-dashboard/queue.html`
- `usc-admin/admin-dashboard/student-records.html`
- `usc-admin/admin-dashboard/users.html`
- `usc-admin/student-registration/officer-registration.html`
- `usc-admin/student-registration/student-registration.html`
