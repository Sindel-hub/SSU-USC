# SSU-USC isolated staging setup

This is a deferred setup guide, not authorization to create resources or incur charges. No staging project currently exists. Ask the user for only **one account-permission action at a time**. Do not use production accounts, data or secret values as a substitute. The currently pending user action is applying/publishing the saved environment network-only draft for `api.github.com`.

## 1. Network and GitHub — current gate

An anonymous HTTPS request failed during proxy CONNECT with HTTP 403 (`server: envoy`). It did not reach GitHub. This proves an environment network restriction; it does not establish an invalid token. The attached running policy and the initial configuration draft lacked `api.github.com`.

The domain has now been saved into this chat's configuration draft. The configuration tool returned `status: saved` and `requires_publish: true`. Saving the draft does not apply it or publish the website. Preserve all presets and existing destinations. Once the user applies/publishes that environment configuration, verify once:

```sh
curl --silent --show-error --max-time 15 https://api.github.com/rate_limit
# Inspect only status/transport results; never print tokens.
gh api --silent user
gh repo view Sindel-hub/SSU-USC --json nameWithOwner
```

If anonymous HTTPS reaches GitHub but the authenticated request returns 401, then investigate the supplying GitHub connection/secure GH_TOKEN binding. GH_TOKEN may be proxy-injected and overrides stored gh credentials. Do not copy or replace it merely because `gh auth status` says invalid while the proxy is blocking the request. If repository access is denied after successful authentication, check the connected GitHub App's access to Sindel-hub/SSU-USC rather than replacing a valid credential.

No push, merge or deployment is currently authorized by the user's latest message.

## 2. Firebase staging — ask only after the current gate

Ask permission to create/select one separate **free** Firebase staging project. Do not enable Blaze, paid APIs or billing automatically. It needs staging-only Authentication (email/password), Firestore and a service identity authorized for that staging project. If a required feature needs paid service, stop and obtain explicit approval.

Record its public project ID and public Web App configuration. Do not import production users, passwords, roles, tokens or Firestore documents. Create synthetic test users. Keep service-account JSON only in secure staging Edge Function settings, never in chat or source control. Real provider integration must later verify Firebase Email Enumeration Protection, Firebase password throttling, and whether any configured reCAPTCHA/MFA policy requires additional handling by the password-proof REST call.

## 3. Supabase staging — a separate permission action

Ask permission to create/select one separate **free** Supabase staging project. Do not upgrade or enable paid services. Record only its public project reference/URL in the review. Apply `supabase/email-service.sql` to this staging project, then apply `supabase/gmail-login-rate-limit.sql` there. Review the selected project reference before either operation.

The new rate-limit migration creates only a private budget table and a service-role-only RPC. It does not create or modify Firebase accounts, Gmail verification records, passwords or roles. It has not been applied to any remote project.

## 4. Secure staging configuration — a separate permission action

Use Supabase's secure Edge Function settings for staging-only credentials:

- Existing service requirements: platform-managed Supabase URL/service key, staging Firebase project ID/public API key/service-account JSON, staging portal URL and mail sandbox settings (`RESEND_API_KEY`, `EMAIL_FROM`). Never copy production secrets to staging. Do not send unsolicited email or incur paid mail charges.
- New requirement: `GMAIL_LOGIN_RATE_LIMIT_SECRET`, an independently generated random secret of at least 32 characters. Keep it stable and identical across all instances of the same deployment. Do not expose it in the browser or logs. Identity/client bucket keys are HMAC-SHA256, not raw email/IP strings.
- Leave `GMAIL_LOGIN_TRUSTED_IP_HEADER` unset initially. Enable `cf-connecting-ip` or `x-real-ip` only after verifying that the actual gateway overwrites client-supplied values. Global and per-identity budgets apply even when no trusted client address is available. Never trust an arbitrary forwarded header.

The default database budgets are five attempts per canonical identity per minute, twenty per trusted client per minute (when configured), and 120 globally per minute. They use fixed database-clock minute windows; adjacent-window bursts are possible. Calibrate these defaults in staging. The global budget bounds provider cost and new bucket creation, but an attacker can temporarily exhaust shared Gmail login capacity. Student ID and institutional-email routes remain available. Do not increase budgets or bypass the limiter silently if it rejects traffic.

No full request-body logging or password capture may be enabled on the auth route, API gateway, observability tooling or error tracker. The Edge Function now receives the login password over HTTPS solely to verify it with Firebase; it never stores it, returns it, sends it by email, or logs provider request/response bodies. This replaces the old email-only metadata lookup.

## 5. Deploy and verify the staging backend first

Only after explicit staging permission/access, deploy `usc-email` (including `gmail-login.mjs`, `institutional-accounts.mjs` and shared helpers) to the identified staging project. Apply the SQL and secrets **before** enabling the updated Edge Function. The old `resolve_gmail_login` action must return no metadata. The new `authenticate_gmail` action requires a password and returns protocol `gmail-password-v1` only after successful Firebase password proof, UID binding and ownership/profile checks.

Verify that missing SQL/secrets fail closed (503), rate exhaustion returns 429, and unknown/pending/wrong-password/inactive/conflicting identities all return the same generic 401 body without UID/email/tokens. The protocol is checked by the frontend; an old backend cannot silently act as a compatible password-proof service. The function issues no custom token and creates no account.

The browser completes normal Firebase SDK sign-in with the same password and validates the resulting UID. Firebase-native Gmail accounts (including existing administrators) retain their direct Firebase route. The existing personal Gmail verification, notification preferences, password recovery and administrator reset workflows must still pass. Firebase provider calls can be additional password attempts; staging must check quota/throttling behavior.

## 6. Preview configuration and publishing — permission still required

The current committed/static frontend targets production Firebase and has a production Supabase default. A Vercel Preview or Git branch does **not** isolate those backends. Vercel environment variables alone do not rewrite static JavaScript.

Prepare a reviewed Preview-only configuration/build overlay for:

- `firebase/firebase-config.js`: public staging Firebase configuration only.
- `supabase/supabase-config.js`: public staging Supabase configuration only.
- `shared/app-config.js`: staging `USC_SUPABASE_EMAIL_FUNCTION_URL`, after accounting for the file's default empty assignment; use staging public integrations or disable unrelated production-bound integrations in the isolated output.

Verify the generated Preview files contain staging references and no production service endpoints. Never put service-account/private keys or the HMAC secret into static files. Confirm the backend contract before any frontend deployment.

After GitHub access is restored, staging is configured/tested, and the user authorizes the push, commit/review the exact files on `review/verified-gmail-election-fixes`. Push that branch only, never main, and use the existing Vercel project's non-production Git Preview flow. Preserve the main production-branch setting and deployment protection. Wait for Ready status, verify the actual URL, and give it to the user. No actual Preview URL exists at present.

Test only synthetic staging accounts and a controlled inbox: same UID/password across Student ID, institutional email and verified Gmail; rejected wrong passwords and revoked/unverified addresses; limiter behavior across instances; existing recovery/admin resets; election edits/removals/history. Record the commit SHA, Preview deployment ID and staging backend revision. Wait for explicit approval of the functioning Preview before discussing any production action.

## Local checks available now

```sh
npm test
npm run test:gmail-security
```

The original regression suite has 142 tests. The security suite adds 13 focused password-gating/response/HMAC tests plus the existing 10 actual-handler loopback HTTP tests. Local provider adapters use synthetic data and reject external requests; these results do not prove a deployed Firebase/Supabase integration.

For actual PostgreSQL concurrency, use only a disposable, labelled container with no network and no exposed ports, e.g. PostgreSQL 16. The test rejects a container without the required name prefix, label and network isolation:

```sh
# Local test database only; no production credentials or services.
docker --host=unix:///var/run/docker.sock run --detach \
  --name ssu-local-gmail-rate-test --label com.ssu.test=gmail-rate \
  --network none --memory 512m --cpus 1 --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine
SSU_TEST_POSTGRES_CONTAINER=ssu-local-gmail-rate-test npm run test:gmail-rate-postgres
# Remove only the disposable container created for this test.
docker --host=unix:///var/run/docker.sock rm --force ssu-local-gmail-rate-test
```

Follow the managed runtime Docker proxy/CA instructions when pulling an image; never bypass TLS or network restrictions. No repository dependency or lockfile changes are required for these tests. The HTTP/TypeScript contract suite needs Node 24+.
