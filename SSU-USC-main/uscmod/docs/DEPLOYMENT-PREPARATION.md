# SSU-USC deployment preparation — current security revision

Status: LOCAL VALIDATION; NO REMOTE PREVIEW OR PRODUCTION RELEASE.

Branch: `review/verified-gmail-election-fixes`. Preserve all previous election, login, complaint, administrator and test changes. The user's latest instruction prohibits pushes, merges and deployments until further notice. No production Firebase/Supabase data, configuration or secret has been changed.

## Security findings and implementation

The previous anonymous Gmail-to-UID/email lookup was a membership/metadata oracle. It is retired: `resolve_gmail_login` now returns no identity. The replacement `authenticate_gmail` requires the existing password, verifies it with Firebase server-side, rechecks the authoritative verified Gmail record and active school-account ownership, then returns only UID and Firebase login email with protocol `gmail-password-v1`. No token is issued by the lookup; the frontend completes normal Firebase SDK password sign-in and validates the UID again.

Unknown, pending, removed, wrong-password, disabled, ownership-conflict and provider-error cases share a generic 401 response with no account data. There is a synthetic provider-proof path for absent mappings and a minimum response delay with jitter. These reduce cheap timing differences but are not a formal side-channel guarantee; real-provider timing and Firebase Email Enumeration Protection remain staging checks. Valid direct Firebase-native Gmail accounts retain their original route, including administrator accounts.

**Password-handling change:** the password now goes over HTTPS to the trusted Edge authentication action, then Firebase. It is used only for proof and is never persisted, logged, echoed, emailed or included in rate-limit records. The previously accurate statement that passwords never reach Supabase is superseded. TLS, secret isolation and disabling request-body capture are mandatory staging/deployment checks.

The limiter is a private PostgreSQL table and atomic, service-role-only RPC shared by all Edge instances. It uses database time and a transaction-scoped advisory lock. Default fixed-window limits are 5/minute per HMAC identifier, 20/minute per trusted-client hash when configured, and 120/minute globally. Global exhaustion stops creation of additional arbitrary identifier records. Old buckets expire and are cleaned up. Public/anonymous/authenticated database clients cannot call the RPC or read the table. Missing limiter configuration or database failure fails closed before an account lookup.

A new stable server-only `GMAIL_LOGIN_RATE_LIMIT_SECRET` is required. Optional trusted-IP limiting is disabled unless the deployment explicitly identifies a gateway-sanitized header; global/identity budgets never depend on a spoofable IP header. Capacity/lockout tradeoffs and real gateway behavior must be tested in staging. There is no distributed rate-limit claim based on an in-memory Map: the SQL was exercised against a real isolated local PostgreSQL instance with concurrent independent connections.

The change adds no account creation, password update, custom-claim or role mutation. Existing verification, notifications, recovery, administrator reset controls and school login routes remain in place. Gmail records revoked while password verification is underway are re-read before success.

## Compatibility and release order

This revision changes both frontend and backend protocol. The frontend rejects an old metadata-only response and an unsupported backend action. It must not be deployed alone. Staging and any future explicitly approved production rollout require this order:

1. Apply `supabase/gmail-login-rate-limit.sql` to the explicitly selected project after review.
2. Set the independent HMAC secret in that project's secure Edge settings and verify no password/request-body capture is enabled.
3. Deploy the reviewed `usc-email` function with the updated shared Firebase password verifier and Gmail helper; retain existing per-action session verification and `verify_jwt = false` behavior for public verification/recovery/password-auth actions.
4. Verify the password-gated protocol, uniform failures, database limiter and old-action retirement.
5. Only then publish the matched frontend and perform authorized smoke checks.

This new SQL/secret requirement supersedes the previous revision's “no new schema/secret” statement. Nothing has been applied to a remote project. The combined election draft also needs its reviewed Firestore rules; a frontend-only production release remains incomplete.

## Verified local capabilities and remaining checks

- Existing `npm test`: all 142 tests retained; rerun after this revision.
- `npm run test:gmail-security`: password-proof, enumeration response, UID, HMAC, protocol and actual-handler HTTP contract coverage.
- Real local PostgreSQL suite: concurrent shared budgets, anonymous-role denial, database-clock expiry, malformed-key rejection and hashed-only storage.
- Syntax and diff-whitespace checks.

These checks use synthetic accounts and isolated local services. Actual Firebase password API/reCAPTCHA/throttling behavior, real inbox delivery, Supabase deployed Deno integration, trusted gateway headers and a Vercel Preview remain unverified. Do not call production ready based only on local results.

## Access and staging status

An unauthenticated HTTPS probe was denied at proxy CONNECT with 403 before reaching GitHub. GitHub token validity is therefore unproven. The chat's missing `api.github.com` entry has been saved in the environment configuration draft; the tool reports `requires_publish: true`. Saving is not runtime application. The user's next action is reviewing/saving/publishing that environment configuration only. No credential replacement is justified until GitHub can be reached and an authenticated response is observed.

No staging Firebase or Supabase project exists. The current frontend still points to production services. An interactive Preview must not be treated as isolated until its generated static configuration points only to staging. No Vercel connection or actual Preview URL is available. Follow [STAGING-SETUP.md](STAGING-SETUP.md); request only one account-permission action at a time. Do not create paid services automatically.

## Final release gates

- [ ] Environment network update applied; GitHub API/repository access verified without exposing credentials.
- [ ] Independent free staging projects selected with explicit permission; no production data or secrets copied.
- [ ] New limiter SQL/secret and the matched backend protocol verified in staging.
- [ ] Gateway IP trust, capacity limits, password logging exclusion, provider timing and Firebase protections checked.
- [ ] All regression/security tests pass on the exact proposed revision.
- [ ] Preview-only generated configuration reviewed; no production endpoints or private keys in browser files.
- [ ] User authorizes pushing the exact reviewed development branch; no force-push or main update.
- [ ] Vercel Preview reaches Ready, actual URL is accessible and authorized staging smoke tests pass.
- [ ] User reviews the functioning Preview and explicitly approves the exact production release, including backend SQL/secret/rules changes.
- [ ] Approved commit, backend/rules revisions and rollback versions recorded; normal branch protections preserved.

## Rollback

Before any approved remote release, record the previous frontend deployment/commit and backend/rules revisions. A code rollback must not delete users, passwords, roles, Gmail verification records, votes or audit history.

For staging failures, keep production unchanged and restore the last reviewed staging pair through a new development commit. For a future approved production failure, use a protected revert/known-good Vercel rollback and verify the resulting deployment. Production rollback needs explicit authorization unless already included in the release plan.

Do **not** blindly restore the former unprotected Gmail metadata endpoint. If Gmail authentication must be disabled, keep the retired lookup closed, disable the new Gmail action with a generic failure, and preserve Student ID/institutional login plus verification/recovery/admin operations. The private limiter table can remain during rollback; do not remove it while instances still depend on it. Never roll back authentication records as a substitute for reverting code.
