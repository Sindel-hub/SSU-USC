# Verified Gmail versus suspended native-account conflict — local review only

## Confirmed evidence and limits

Production was investigated read-only. The deployed usc-email remains version 23, ACTIVE, with the bundle digest recorded at the prior approved deployment. The downloaded live login JavaScript exactly matches the reviewed baseline and attempts Firebase sign-in directly with a personal Gmail before consulting the verified mapping.

The designated Gmail has one verified Supabase student_email_accounts record. Its UID is unchanged from the owner-confirmed active student baseline; requested_email and verified_email match and verified_at is present. The original owner-attested Firestore baseline is student / approved / active, verified student, active standing, no officer permissions; the owner also confirmed the corresponding Authentication account exists and is enabled. Those Console observations have not been independently re-read here. Full account identifiers and the mapping evidence are retained privately outside Git, not in this report or tests.

The publicly readable institutional-login alias for the designated personal Gmail is absent (404); this is not a duplicate verified Supabase mapping. The Student ID alias is separate and is not used by the personal-Gmail branch.

No authorized Firebase administrator read connection is available. The owner supplied a separate mock UID/Student ID and confirmed a student profile with accountStatus=suspended, isActive=false and isVerifiedStudent=false. Its Auth disabled flag is not yet verified. These Console observations have NOT been independently re-read by the assistant; production Firebase administrative access is unavailable. The precise UID selected during the historical production attempt is NOT logged in the available evidence, and no further login was performed to obtain it. The owner-confirmed UIDs are distinct. The old Auth primary-email/disabled details and any forensic trace of the historical returned UID remain unverified. Do not invent an old UID, infer it from an email, or claim all conflicting production records have been verified.

## Root cause: two confirmed code defects

1. In index/js/index.js, signInByIdentifier first called signInSecurely(personal Gmail, password). When Firebase accepted the native account, the function returned that UID immediately and never called authenticate_gmail. bindSignin then loaded users/{that UID}. Its existing suspension check produces exactly: "This school account is suspended or inactive." The restriction is correct; account selection can be wrong for a verified mapped login.
2. The Edge resolveVerifiedGmailAccount also rejected any other Firebase owner of the Gmail, without considering whether that separate legacy account was suspended or disabled. Simply changing frontend order would therefore still block the valid mapping in the reported inactive-owner scenario.

The Admin Dashboard's saved-account directory is backed by Firestore users records. Its suspended profile is distinct from Firebase Authentication's email identity; suspension does not necessarily remove/disable the Auth record or release its login email. A stale saved profile alone does not redirect authentication: the relevant conflict is Firebase's native Gmail identity and the verified Supabase mapping. This distinction remains important when confirming the mock record.

A synthetic reproduction ran the exact downloaded production frontend, with intercepted Firebase/Supabase adapters and an enabled native mock Auth account whose Firestore profile is suspended. The native-first implementation selected the mock UID, made zero verified-Gmail backend requests, and displayed the exact suspension message. The proposed implementation instead made one proof-gated backend request, signed into the existing mapped school UID and opened its student dashboard. Both runs used synthetic credentials, no real network authentication, and no production data writes. This confirms the mechanism; it is not a new observation of the historical production UID.

## Proposed correction

All personal-Gmail selection goes through the existing authenticate_gmail endpoint before the browser SDK signs in. A valid verified mapping has precedence. The backend checks the existing password against the mapped account's actual Firebase login email, binds the password proof to that UID, and rechecks mapping, Auth status, profile eligibility and Gmail conflicts. The browser then performs its normal Firebase password sign-in to that returned existing identity, verifies the SDK UID is identical, and runs the existing role/standing/suspension/custom-claim checks against the same UID.

A different native Gmail owner may coexist with the verified mapping only when authoritative backend reads establish an existing student/officer profile, a known approved/suspended status, and explicit isActive=false. The Auth UID, canonical mailbox and disabled-field type must be verifiable. The mapped target must be explicitly approved and isActive=true. Multiple distinct Firebase owners across canonical/original aliases remain blocked even if all appear inactive. Disabled Auth with an active/contradictory Firestore profile is not sufficient for the exception. The native Auth email, UID, password, profile and role are never changed. Active, administrator, unknown-profile and missing-Auth conflicts remain fail-closed. Reactivation before validation blocks the ambiguity again. A suspended/disabled mapped target is always rejected; another active/native account is not used as fallback. The old mock password cannot authenticate the mapped student.

When NO valid verified mapping exists, an eligible native Gmail account can still use its existing UID/password. The same server limiter and password proof apply, then the browser SDK and existing authorization checks run. Native administrators still need the existing trusted admin claim. Native selection rechecks that no valid mapping was added while proof was in flight and rejects ambiguous Gmail aliases. Student ID and institutional-email paths are unchanged.

The authenticated response adds loginMethod (verified-gmail or firebase-native). It is returned only after password proof, with no extra profile data or tokens. The frontend requires this marker to avoid accepting a backend with the old selection policy. Only verified-gmail results receive the existing verifiedGmailUid marker; native Gmail does not gain a verification exemption.

## Preserved restrictions and compatibility

No account creation, ownership transfer, reactivation, deletion, Gmail remapping or password change is introduced. The proposed source has no account writes. Account eligibility is checked against the selected UID, not borrowed from another record.

Apps Script/shared provider code, verification/recovery handlers, database migration, secrets and rate thresholds are unchanged from the local base e8552d9. Existing provider fingerprints and recovery tests still pass. Rate budgets remain before all lookup/proof work; 429/503 gates and generic credential-failure responses remain. Canonicalized Gmail identity, global budgets and trusted-header restrictions are retained. Native Gmail now also depends on this backend/budget, an intentional change needed to prevent bypass of mapping precedence. A backend outage or exhausted global budget therefore blocks native Gmail as well; Student ID/institutional routes retain existing Firebase behavior.

## Tests

- Baseline f7898c9 before this review: 345 passed (304 application + 27 security/HTTP + 14 PostgreSQL).
- Complete npm test after hardening: 315 passed, 0 failed.
- Gmail security and real-handler loopback HTTP integration: 27 passed, 0 failed.
- Isolated PostgreSQL 17.6 limiter integration: 14 passed, 0 failed. Test container has no network/host ports and was stopped afterward.
- Syntax and git diff checks pass.

New coverage includes mapped active/suspended/inactive/disabled accounts, inactive versus active/admin/unknown native owners, wrong mock versus mapped passwords, ownership/mapping races, Gmail aliases, native/student/admin continuity, trusted admin claims, SDK UID mismatches, protocol-marker compatibility, rate gates and record immutability. The real HTTP handler is tested for inactive-owner success and active-owner denial. The disabled-Auth/active-Firestore legacy test now deliberately expects denial rather than the former allowance, matching the requested ambiguous-conflict restriction. Eleven further hardening regressions were added; no test was disabled or removed. Existing tests asserting native-first SDK ordering were updated to assert the new required server-first policy while preserving UID/password behavior; no test was disabled or removed.

## Deployment boundary and risks

This is a separate review branch. Publication as a development branch, draft PR and frontend Vercel Preview is authorized for review only. No merge, backend deployment or production deployment is authorized. Production remains version 23 with the old selection behavior. No further login, limiter invocation, email, account operation, secret update or migration was performed during investigation.

The original f7898c9 remains preserved in branch history. Security-review hardening is a separate descendant commit. After review, the branch may be published as a draft PR/Frontend Preview as explicitly authorized; it must not be merged or deployed automatically. If approved later, review the exact patch and confirm the old mock Auth record read-only first. Deploy the backward-compatible backend additions BEFORE the frontend that requires loginMethod; do not release frontend alone against version 23. The old frontend keeps its native-first defect until the frontend update is reviewed and released. Do not change production records as a workaround. No new SQL or secret is required. Preserve the Apps Script baseline and prior backend/frontend artifacts.

Real cross-service behavior remains untested for this patch. Generic failures remain deliberate for privacy. Active-owner conflicts require an explicit ownership/support decision; the fix will not silently reassign an active Gmail owner. Fixed-window rate limits retain their existing availability tradeoffs. Mapping/ownership checks are repeated around proof but are not a distributed transaction across Firebase and Supabase; no stronger atomicity guarantee is claimed. Any future production deployment or controlled login/email/account test needs separate approval. Never automatically delete/reactivate the mock account or roll back other resources.

## Preview boundary

The frontend Preview includes the real changed source. The corrected Supabase backend is NOT deployed, and production remains version 23. The new frontend requires the new loginMethod response marker and fails closed against the current backend. Do not perform a production Gmail login attempt through this Preview. There are no configured isolated cloud staging services; therefore a functioning cloud end-to-end preview of the corrected Gmail behavior is not claimed. Review backend behavior using the passing real-handler loopback tests with synthetic fixtures, or configure staging under separate authorization before interactive authentication testing. Existing production user records and passwords must not be used for Preview testing.
