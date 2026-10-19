# Complaint review compatibility

Older complaints can have classification stored only in a review thread, or no
thread field. The browser now sends the selected classification with status
updates, and the rules treat a missing thread as an empty history. Existing
permissions, valid classifications, and the 200-entry thread limit still apply.
No data migration is required.

## Release requirements

The website and Firebase rules are released separately. A Vercel preview or
GitHub merge does not publish Firestore rules. After reviewing and approving the
rules change, publish `firestore.rules` to the existing Firebase project
`universitystudentcouncil-856cc` through Firebase Console → Firestore Database →
Rules, or run this from `SSU-USC-main/uscmod` using an authorized Firebase login:

```sh
npx firebase deploy --only firestore:rules --project universitystudentcouncil-856cc
```

This updates the shared database rules used by both production and previews;
coordinate approval before publishing. Do not replace rules with open access or
change users' roles to work around a denial.

## Verify

With an approved, active officer authorized for complaint review, classification,
status, and feedback (such as the President preset), open an existing test case.
Save its classification, send feedback, then save Resolved. Reload and verify the
status and feedback persist and appear in the owning student's Tracklist.
Officers with custom permissions must explicitly have the necessary permissions;
adding a previously thread-only classification also requires complaints.classify.

If writes still fail, inspect the browser's Firestore permission-denied error,
the deployed rules, and the officer's administrator-controlled users profile
(accountStatus, isActive, officePosition, officerPermissionSource,
officerPermissions). Do not share session tokens or passwords. A generic alert
cannot establish whether deployed rules or account permissions are responsible.

## Local regression checks

```sh
npx firebase emulators:exec --project demo-complaint-review --only firestore \
  'node --test tests/complaint-review.rules.test.mjs'
```

These tests execute the actual browser mutation functions against the repository
rules, including old record shapes and rejected unauthorized writes. They do not
inspect or modify the live database.
