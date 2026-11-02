> Superseded for administrator-entered passwords: the user requested removal. The removal branch restores generated reset/recovery and retires admin_set_password. The package checksums and deployment proposal below describe the previous review and must not be used as a release authorization or current package identity. The separate Gmail login mismatch remains unresolved in production.

# Integrated usc-email compatibility review

## Production evidence and decision

GitHub main is dcef00c2529924eed182ea334cf268c76e06214a (PR39 merge), following PR38 merge 4338064ae2d595b74f41b9b7b35cf3f7cd2d1091. Vercel production deployment 7501868396 succeeded at https://ssu-eep26lpuf-usc-projects.vercel.app. Six live frontend HTML/JS assets were retrieved from https://ssu-usc.vercel.app and matched PR39 commit 736cc29 byte-for-byte. No login was attempted.

Production project svgfxatigtjdrwzibjbu still runs usc-email version23 ACTIVE, verify_jwt=false. Management API bundle SHA256 is 85099f84d7e7e2cc2d5481183e6d8fb39545c47c5be04bf3c91b086b97dd1f3f, byte-identical to the previously preserved v23 bundle. Its ezbr_sha256 is a101eb3f88e7d3c24dc14112d0e2569ec8c2df423ac91d7d8d6a8745c9f8ba9a. Bundle identity establishes the previously verified ea6c5e5 source relationship; it is not the new merged backend source.

NO-GO for automatic deployment. Safest immediate recovery is an explicitly authorized, artifact-verified Vercel rollback to deployment ssu-gdympiksi, commit725b818a06ece61b395e29afd5e4887c03161284. This avoids releasing untested-in-cloud authentication changes during an incident, but restores the original Gmail ownership-conflict limitation. Retained deployment assets remain Vercel-protected and Vercel rollback credentials are unavailable here; do not claim it is restored or perform an unverified rollback. GitHub history stays unchanged. Future merges can redeploy new frontend code; coordinate further merges with backend readiness.

## Complete frontend action inventory

Existing backend-supported contracts: get, save, remove, verify, recover, password_changed, institutional_get, institutional_request, institutional_verify, admin_reset_password, admin_remove_suspended_account. resolve_gmail_login is intentionally retired/denied and must not be reopened; current login uses authenticate_gmail.

Two incompatible contracts were found:
- authenticate_gmail exists in v23, but its successful gmail-password-v1 response lacks loginMethod. All personal Gmail login now requires verified-gmail or firebase-native. v23 also rejects different native ownership and lacks the reviewed native fallback/mapping precedence. It therefore cannot support the merged login flow.
- admin_set_password is absent in v23 and produces Unknown email-service action. Existing generated reset uses admin_reset_password and must keep its old behavior. New manual requests must not silently become generated passwords or email recovery.

Student ID and institutional-email paths do not use the changed Gmail contract. Administrators using Gmail are affected; non-Gmail admin sign-in retains its existing path and claim checks. Existing sessions were not probed or altered. No actual live sign-in success/failure is claimed.

## Minimal correction and privilege review

PR38 already supplies the reviewed Gmail mapping-first/password-proof/UID-consistency/loginMethod implementation. PR39 already supplies the separate admin_set_password Edge action and matching browser fallback. Deploying only older ea6c5e5 or PR38 code would leave manual passwords broken. The deployment package must include both merged features and these additional checks.

The local correction adds current Firebase custom-claim metadata to the existing trusted UID lookup. Only manual password setting gains stronger checks: recently authenticated admin token, approved explicitly active admin Firestore profile, same-UID enabled current Firebase administrator with verified email and current admin claim. Targets must be same-UID enabled, school-provisioned, approved explicitly active verified students/officers with eligible standing and non-privileged Auth claims. Missing/unknown claims, administrator claims, disabled, suspended, unverified and mismatched targets fail closed. Self-reset remains forbidden. Password syntax is checked server-side and its exact value is used. Passwords are not persisted in Firestore/audit records; the existing authenticated response/credential card still returns the newly set password to its initiating admin. Existing generated-reset behavior is preserved.

The existing Firebase callable path is preserved and is NOT being deployed in this proposal. Production Firebase callable availability/version was not independently verified; the browser's configured Spark fallback supplies the Supabase route when the callable fails. PR17 is an older unmerged alternative, not a prerequisite to this Edge deployment. Do not merge it as an incident workaround.

No frontend edits are needed for the two observed contracts. Apps Script provider selection/signing/config and existing session-verification code remain byte-identical to ea6c5e5 in the shared prefix. All helper code following generateFirebaseResetLink (recovery, Firebase password proof, limiter) is byte-identical. Gmail auth module matches reviewed PR38 exactly. Entry-point recovery/verification/settings/delivery handlers, account removal module and SQL migrations/secrets are unchanged by this branch.

## Validation

- Full npm test:319 passed, zero failures/skips, including existing authentication, providers, recovery, Student ID, institutional-email and UI regressions.
- Gmail security/actual Edge handler and browser-service loopback HTTP suite:32 passed, zero failures/skips.
- New manual-action HTTP checks: exact chosen target password, credential-free audit/metadata, absent/weak password rejection, unauthorized/stale/inactive/unverified admins, privileged/disabled/suspended/unverified/UID-mismatched targets, and old-backend rejection without password mutation.
- Frontend action inventory regression is part of npm test. Existing wrong-password, ownership conflicts, disabled-account, UID mismatch, legacy response rejection and shared limiter regressions remain enabled.
- Synthetic in-memory identities only. Real handler/helper code runs locally, with Google/Supabase/email adapters replaced and unexpected network requests rejected. No production credentials, records, login attempts, password writes or emails were used. No cloud staging or real Firebase password/reset integration was performed. The previously tested database migration is unchanged; its SQL concurrency suite was not rerun for this code-only patch.

## Exact backend source package SHA256

- `supabase/config.toml`: `66145270ab154bc5f836c9d9bc34ed8272323ba4958633aacf505586f9ffc8e9`
- `supabase/functions/usc-email/index.ts`: `22a7f2c8fafbe66572a8b8c4c9d624d3d1e712e2b64efc97fa279a76e1d757c1`
- `supabase/functions/usc-email/gmail-login.mjs`: `4db0df908e2bd98e6b4ec03940829c7396a6db8c09d996a991753cfe76175188`
- `supabase/functions/usc-email/institutional-accounts.mjs`: `64cb8a8dc36f12aef3389eb428c67a1d02e2068bfd4711d3f430098b3f34bb14`
- `supabase/functions/usc-email/account-removal.mjs`: `5202244d46d759b19f3af6518fa460a6139d2d40abecb6eae3cafcde7d703216`
- `supabase/functions/_shared/usc-email-common.ts`: `af8b8d06b20a962c0667457b38111dbed4178e96e57b43b0de928d53436552cd`

All relative imports must be packaged from this reviewed branch/commit, including the shared helper, gmail-login, institutional-accounts and account-removal. Keep the existing pinned external SDK dependency and verify_jwt=false. These source-file hashes are not a claimed built/deployed bundle hash; capture that separately after any authorized deployment.

## Authorization boundaries and coordinated release

Nothing here authorizes a production operation. Do not merge this draft automatically.

1. Immediate recovery option, separately authorized: authenticate to Vercel; verify previous retained deployment/source artifacts and commit725b818; restore only its production alias through Vercel. Compare live HTML/JS, then stop. If artifacts cannot be verified, stop. No GitHub revert, force-push, Firebase/Supabase change or login test.
2. Obtain separate authorization/access for isolated staging resources if required. Use dedicated Firebase/Supabase, synthetic fixtures/credentials, no copied production secrets or email senders. Exercise mapping conflicts, exact passwords, admin eligibility and limits against real staging providers. Free quotas/costs and credential capabilities must be confirmed before creating anything. No staging cloud resources were created here.
3. After staging and explicit backend approval, recheck current production source, metadata, reviewed hashes, existing Gmail limiter RPC/table and HMAC secret metadata without exposing values. Preserve exact v23 source/bundle and current Vercel deployment references. No new secret, schema, provider or Firebase config is required by this patch. If IAM lacks existing lookup/update/revocation/audit rights, stop; do not broaden permissions automatically.
4. Deploy ONLY usc-email from the exact reviewed integrated commit to svgfxatigtjdrwzibjbu, verify_jwt=false. Never deploy workers/Facebook/Firebase functions or apply migrations/secrets incidentally. Verify ACTIVE, source/package identity, metadata and non-auth startup/health evidence. Stop on failures; no automatic rollback.
5. If the new frontend remains live, this backend deployment is expected to restore both contracts immediately; do not redeploy frontend unnecessarily. If frontend was rolled back, separately authorize promotion of the already-reviewed matching frontend after backend verification. Check served assets against approved sources; do not change GitHub history.
6. Any production login, chosen-password save, rate-counter write, recovery or email test requires separate explicit authorization. Static compatibility does not prove real IAM/provider execution or inbox delivery.

## Rollback

If a backend release fails while new frontend is live, restoring v23 alone would recreate both incompatibilities. Separately authorize and verify restoration of the old compatible frontend first, then separately authorize restoration of the preserved v23 source if needed. If old frontend was already restored before backend rollout, leave it in place during an authorized backend rollback. Backend source restoration creates a new revision number, not numerical23. Never roll back accounts, passwords, mappings, counters, logs, SQL or secrets as cleanup. Source rollback cannot undo a real password change; no such production test is authorized here. Keep every next operation gated by explicit approval.

Remaining risks: no cloud staging, Vercel artifact/rollback access unverified, IAM not tested by mutation, standard cross-service race/partial audit failure behavior, normal Firebase ID-token validity until expiry/revocation enforcement, and live native-Gmail/admin dependence on backend/shared rate-limit availability. Existing post-password audit failure warnings remain; do not retry a possibly successful password change blindly. No account is reactivated or modified by this review.

## Verified live frontend SHA256

- `index/index.html`: `25f1eb4aa931bba6d706de9abdc7990f2e4f40ab6525bcf19adea45c087716c4`
- `index/js/index.js`: `e0716c694a4035f5654afb85f70d3a546783478648fb24ba42fb135095d76ac5`
- `shared/security-client.js`: `96bec4f2704e8add120f04c938e7a93ff7397674c105160d6a1e7856b9067da1`
- `shared/supabase-email-service.js`: `9460b2e37662ac9bda2021dc0d4ae0910d4ac1e8c2855b9a25d2b8884070b311`
- `usc-admin/admin-dashboard/js/admin-users.js`: `761c33ec80c4a91bdc044f03de59473f1281969d4e4aad05987b768d26268571`
- `usc-admin/admin-dashboard/users.html`: `06c12619eda0f7afcbe8ee0fe8ce5c98469db98b28596fe405001c2ecf1bc783`
