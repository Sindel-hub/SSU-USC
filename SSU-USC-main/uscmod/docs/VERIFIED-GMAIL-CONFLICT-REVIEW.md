# Verified Gmail versus suspended native-account conflict — local review only

## Confirmed evidence and limits

Production was investigated read-only. The deployed usc-email remains version 23, ACTIVE, with the bundle digest recorded at the prior approved deployment. The downloaded live login JavaScript exactly matches the reviewed baseline and attempts Firebase sign-in directly with a personal Gmail before consulting the verified mapping.

The designated Gmail has one verified Supabase student_email_accounts record. Its UID is unchanged from the owner-confirmed active student baseline; requested_email and verified_email match and verified_at is present. The original owner-attested Firestore baseline is student / approved / active, verified student, active standing, no officer permissions; the owner also confirmed the corresponding Authentication account exists and is enabled. Those Console observations have not been independently re-read here. Full account identifiers and the mapping evidence are retained privately outside Git, not in this report or tests.

The publicly readable institutional-login alias for the designated personal Gmail is absent (404); this is not a duplicate verified Supabase mapping. The Student ID alias is separate and is not used by the personal-Gmail branch.

No authorized Firebase administrator read connection is available. The old mock account's actual Firebase UID, current primary-email ownership/disabled flag and Firestore status have NOT been independently inspected. Their existence/suspension is owner-reported. The precise UID selected during the historical production attempt is NOT logged in the available evidence, and no further login was performed to obtain it. A read-only Console confirmation of the mock UID and its role/accountStatus/isActive/disabled fields remains requested. Do not invent an old UID, infer it from an email, or claim all conflicting production records have been verified.

## Root cause: two confirmed code defects

1. In index/js/index.js, signInByIdentifier first called signInSecurely(personal Gmail, password). When Firebase accepted the native account, the function returned that UID immediately and never called authenticate_gmail. bindSignin then loaded users/{that UID}. Its existing suspension check produces exactly: "This school account is suspended or inactive." The restriction is correct; account selection can be wrong for a verified mapped login.
2. The Edge resolveVerifiedGmailAccount also rejected any other Firebase owner of the Gmail, without considering whether that separate legacy account was suspended or disabled. Simply changing frontend order would therefore still block the valid mapping in the reported inactive-owner scenario.

The Admin Dashboard's saved-account directory is backed by Firestore users records. Its suspended profile is distinct from Firebase Authentication's email identity; suspension does not necessarily remove/disable the Auth record or release its login email. A stale saved profile alone does not redirect authentication: the relevant conflict is Firebase's native Gmail identity and the verified Supabase mapping. This distinction remains important when confirming the mock record.

A synthetic reproduction ran the exact downloaded production frontend, with intercepted Firebase/Supabase adapters and an enabled native mock Auth account whose Firestore profile is suspended. The native-first implementation selected the mock UID, made zero verified-Gmail backend requests, and displayed the exact suspension message. The proposed implementation instead made one proof-gated backend request, signed into the existing mapped school UID and opened its student dashboard. Both runs used synthetic credentials, no real network authentication, and no production data writes. This confirms the mechanism; it is not a new observation of the historical production UID.

## Proposed correction

All personal-Gmail selection goes through the existing authenticate_gmail endpoint before the browser SDK signs in. A valid verified mapping has precedence. The backend checks the existing password against the mapped account's actual Firebase login email, binds the password proof to that UID, and rechecks mapping, Auth status, profile eligibility and Gmail conflicts. The browser then performs its normal Firebase password sign-in to that returned existing identity, verifies the SDK UID is identical, and runs the existing role/standing/suspension/custom-claim checks against the same UID.

A different native Gmail owner may coexist with the verified mapping only when authoritative backend reads establish an existing student/officer profile and either explicit suspension/inactivity or disabled Auth status. The native Auth email, UID, password, profile and role are never changed. Active, administrator, unknown-profile and missing-Auth conflicts remain fail-closed. Reactivation before validation blocks the ambiguity again. A suspended/disabled mapped target is always rejected; another active/native account is not used as fallback. The old mock password cannot authenticate the mapped student.

When NO valid verified mapping exists, an eligible native Gmail account can still use its existing UID/password. The same server limiter and password proof apply, then the browser SDK and existing authorization checks run. Native administrators still need the existing trusted admin claim. Native selection rechecks that no valid mapping was added while proof was in flight and rejects ambiguous Gmail aliases. Student ID and institutional-email paths are unchanged.

The authenticated response adds loginMethod (verified-gmail or firebase-native). It is returned only after password proof, with no extra profile data or tokens. The frontend requires this marker to avoid accepting a backend with the old selection policy. Only verified-gmail results receive the existing verifiedGmailUid marker; native Gmail does not gain a verification exemption.

## Preserved restrictions and compatibility

No account creation, ownership transfer, reactivation, deletion, Gmail remapping or password change is introduced. The proposed source has no account writes. Account eligibility is checked against the selected UID, not borrowed from another record.

Apps Script/shared provider code, verification/recovery handlers, database migration, secrets and rate thresholds are unchanged from the local base e8552d9. Existing provider fingerprints and recovery tests still pass. Rate budgets remain before all lookup/proof work; 429/503 gates and generic credential-failure responses remain. Canonicalized Gmail identity, global budgets and trusted-header restrictions are retained. Native Gmail now also depends on this backend/budget, an intentional change needed to prevent bypass of mapping precedence. A backend outage or exhausted global budget therefore blocks native Gmail as well; Student ID/institutional routes retain existing Firebase behavior.

## Tests

- Complete npm test: 304 passed, 0 failed.
- Gmail security and real-handler loopback HTTP integration: 27 passed, 0 failed.
- Isolated PostgreSQL 17.6 limiter integration: 14 passed, 0 failed. Test container has no network/host ports and was stopped afterward.
- Syntax and git diff checks pass.

New coverage includes mapped active/suspended/inactive/disabled accounts, inactive versus active/admin/unknown native owners, wrong mock versus mapped passwords, ownership/mapping races, Gmail aliases, native/student/admin continuity, trusted admin claims, SDK UID mismatches, protocol-marker compatibility, rate gates and record immutability. The real HTTP handler is tested for inactive-owner success and active-owner denial. Existing tests asserting native-first SDK ordering were updated to assert the new required server-first policy while preserving UID/password behavior; no test was disabled or removed.

## Deployment boundary and risks

This is a separate LOCAL review branch only. No push, merge, preview deployment or production deployment is authorized or performed. Production remains version 23 with the old selection behavior. No further login, limiter invocation, email, account operation, secret update or migration was performed during investigation.

If approved later, review the exact patch and confirm the old mock record read-only first. Deploy the backward-compatible backend additions BEFORE the frontend that requires loginMethod; do not release frontend alone against version 23. The old frontend keeps its native-first defect until the frontend update is reviewed and released. Do not change production records as a workaround. No new SQL or secret is required. Preserve the Apps Script baseline and prior backend/frontend artifacts.

Real cross-service behavior remains untested for this patch. Generic failures remain deliberate for privacy. Active-owner conflicts require an explicit ownership/support decision; the fix will not silently reassign an active Gmail owner. Fixed-window rate limits retain their existing availability tradeoffs. Mapping/ownership checks are repeated around proof but are not a distributed transaction across Firebase and Supabase; no stronger atomicity guarantee is claimed. Any future production deployment or controlled login/email/account test needs separate approval. Never automatically delete/reactivate the mock account or roll back other resources.
