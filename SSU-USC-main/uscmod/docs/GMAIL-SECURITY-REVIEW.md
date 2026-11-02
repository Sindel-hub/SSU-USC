# Verified Gmail authentication hardening — review record

Local branch: `review/verified-gmail-election-fixes`. No push, merge, remote SQL, Edge Function deployment, Vercel deployment or paid service creation occurred. Existing draft work was preserved; no file or test was removed.

## Before and after

Before: an anonymous email-only action returned the verified account's Firebase UID and login email. It had no shared server-side rate budget.

After: the email-only action is retired and discloses no identity. The new action requires a password. Firebase proves that password server-side before profile/ownership checks or account metadata are returned. The verified mapping is read again after proof. The browser then performs its normal Firebase sign-in and rejects a mismatched UID. No account is created and no role, password or custom claim is changed by this route.

The new protocol is `authenticate_gmail` / `gmail-password-v1`. The frontend rejects a legacy successful metadata-only response. Passwords are sent only in HTTPS POST bodies to the trusted Edge service and Firebase, never URL parameters, logs, stored budget records or responses. The Firebase adapter discards provider tokens and errors. Existing native Firebase Gmail, Student ID, institutional email, verification, notifications, recovery and administrator-reset routes remain present.

## Enumeration and abuse controls

- Unknown, pending, changed/removed, inactive, disabled, wrong-password and ownership-conflict cases share a generic 401 response without UID, auth email or tokens.
- Absent mappings perform a synthetic Auth lookup/password-proof path; wrong-password requests do not inspect school profiles or Gmail-owner metadata. Responses have minimum-delay/jitter normalization. This is not a formal proof against all timing side channels; test real-provider behavior in staging.
- Account information is available only after correct password proof and UID/ownership checks. Successful authentication inherently differs from a rejected password; that distinction is intentional.
- PostgreSQL enforces one shared atomic budget across Edge instances: 5/minute per HMAC identity, 20/minute per trusted-client hash if configured, 120/minute globally. Global exhaustion bounds additional key creation. Fixed-window boundary bursts and shared-capacity denial of service remain capacity considerations; calibrate in staging.
- The RPC is service-role-only and the budget table is private under RLS. Records contain HMAC hashes/counters/times, not raw email/IP/password data.
- Missing database RPC/secret fails closed with 503; an exhausted budget returns 429. Neither condition performs account lookup. Optional IP headers are ignored unless explicitly configured and guaranteed sanitized by the gateway; global and identity budgets do not depend on that option.

## Tests actually executed

| Command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `npm test` | 142 | 0 | 0 |
| `npm run test:gmail-security` | 23 | 0 | 0 |
| `SSU_TEST_POSTGRES_CONTAINER=ssu-local-gmail-rate-test npm run test:gmail-rate-postgres` | 6 | 0 | 0 |

The 23-test suite includes 13 new focused security/provider/HMAC checks and the original 10 actual-handler HTTP contract tests, updated for the password-gated protocol. The original 142-test suite remains enabled. No assertions were disabled to obtain these results.

PostgreSQL 16 ran in a disposable, labelled Docker container with network mode `none`, no exposed port, synthetic roles/data and tmpfs storage. Independent concurrent connections shared the actual SQL budgets. Tests also verified database time/reset/expiry, permission denial, malformed-key rejection and hashed storage. No production database or credentials were used.

TypeScript/helper syntax checks and `git diff --check` passed. HTTP tests compile the real Edge code and run its actual handler plus browser service over loopback, with synthetic provider adapters and an external-network prohibition. They are not a deployed Deno/Firebase integration or a real inbox-delivery test.

## Files in this security revision

Existing draft files updated:

- `index/index.html` — version the updated login module.
- `index/js/index.js` — use the password-gated action before final Firebase sign-in; retain UID validation and other login routes.
- `shared/supabase-email-service.js` — require the password-proof protocol and avoid an email-only metadata request.
- `supabase/functions/_shared/usc-email-common.ts` — Firebase password-proof adapter and secret-keyed HMAC helper, without credential logging/token return.
- `supabase/functions/usc-email/index.ts` — retire the old action; wire database budgets, password authentication and optional gateway trust.
- `supabase/functions/usc-email/gmail-login.mjs` — generic failure handling, password-before-metadata gating, post-proof mapping recheck and timing normalization.
- `tests/verified-gmail-login.test.mjs` — retain 20 existing scenarios while updating the HTTP contract assertions for required server-side password proof.
- `tests/verified-gmail-http.integration.test.mjs` — retain 10 actual-handler scenarios and verify retirement of the metadata endpoint and the new protocol.
- `package.json` — add explicit security and local-PostgreSQL test commands without removing existing regression commands.
- `docs/DEPLOYMENT-PREPARATION.md` — update security findings, required backend migration/secret and rollback gates.

New files:

- `supabase/gmail-login-rate-limit.sql` — private shared-budget table, atomic RPC, expiry and role permissions.
- `tests/gmail-password-security.test.mjs` — password, UID, generic-response, revocation, protocol, Firebase-adapter and HMAC coverage.
- `tests/gmail-rate-limit.postgres.integration.test.mjs` — actual isolated PostgreSQL concurrency and permission tests.
- `docs/STAGING-SETUP.md` — staged, free-resource-only instructions and one-permission-step-at-a-time workflow.
- `docs/GMAIL-SECURITY-REVIEW.md` — this review and evidence record.

## Access findings and current next action

An anonymous request to GitHub was refused at the environment proxy's HTTPS CONNECT stage, with 403 and `server: envoy`. It never reached GitHub. The running policy and original draft lacked `api.github.com`. GitHub token validity is not established, and no credential was replaced or displayed.

The network-only entry `api.github.com` has now been saved into this chat's environment configuration draft. The tool reported `status: saved`, `requires_publish: true`. This is not runtime application and is not website publication. The next user action is to review/save and publish that **environment configuration only**. Recheck API access after that meaningful state change; do not repeatedly retry or replace credentials before observing a genuine GitHub authentication response.

No staging projects exist, and the static frontend still names production backends. Do not publish an interactive Preview connected to them. After network access, take the next staging-account permission step separately. The latest user instruction prohibits pushing, merging and deploying; wait for that authorization too. There is no actual Preview URL to report.

Use STAGING-SETUP.md and DEPLOYMENT-PREPARATION.md for deferred backend-first staging steps, remaining provider/gateway checks and rollback. Do not revert to the old metadata oracle during rollback. Production remains unchanged and any future production release requires explicit approval of the functioning Preview, including its backend migration and secret requirements.
