# Gmail login prerequisites — prepared, not applied

## Findings and current readiness

Target: Supabase `svgfxatigtjdrwzibjbu`. Production PostgreSQL reports 17.6. Read-only catalog searches found neither the required objects nor alternate public-schema names/protocol-compatible functions or tables. The Supabase migration-history relation does not exist. Secret-name metadata contains no Gmail/login rate-limit secret. Existing secret metadata is unchanged. This establishes current absence; absent history cannot prove whether a past object was never applied or subsequently removed.

Repository history shows the original limiter SQL was added in commit 2fefaee as `supabase/gmail-login-rate-limit.sql`, outside `supabase/migrations`. The only pre-existing tracked migration is the unrelated Facebook migration. The evidence is consistent with omitted deployment, not an alternate production implementation. Never run a blanket `supabase db push`: without migration history it could apply unrelated files.

PR #36 is merged. Reviewed compatibility commit: `ea6c5e5b1fc259de8d03e8d4f716143c7e526933`. GitHub merge commit: `ead36b673c8df04ef4b9db386d597c6cddb35d91`. The deployed `usc-email` is still version 21, ACTIVE, verify_jwt=false; a GitHub merge is not an Edge deployment. This branch starts from the compatibility commit and changes no Edge/frontend/Firebase/Vercel source or production configuration.

Recommendation: **the prerequisites are locally tested and ready for review; production remains NO-GO until the operations below are explicitly authorized, applied and verified.** No production SQL, secret configuration, Edge deployment, account operation or email send was performed.

## Migration and least privilege

Canonical SQL: `supabase/migrations/202611030001_gmail_login_rate_limit.sql`. The legacy standalone file is kept byte-identical to prevent conflicting manual installations. Apply this one file in one transaction only after project/source verification. No extensions or additional services are needed.

It adds only `public.gmail_login_rate_limits` and `public.consume_gmail_login_budget(text,text)`. It does not read or modify student accounts, Gmail mappings, Firebase identities, passwords, existing records, notifications or delivery logs. Reapplication preserves counter rows and unrelated tables. Expired-row cleanup exists inside the RPC and affects only this newly introduced technical counter table; defining the function does not execute cleanup.

- RLS enabled, no browser policies. Revoke table privileges from PUBLIC, anon, authenticated and service_role. Even service_role's BYPASSRLS does not bypass the table ACL; its access is through the RPC only.
- SECURITY DEFINER has explicit trusted owner postgres. Apply as the project's trusted migration administrator. Production postgres has BYPASSRLS; an owner bypass is intentional for this narrowly scoped RPC. No browser role owns or can replace it.
- Fixed `search_path=pg_catalog`; all application tables are explicitly public-qualified. No caller-supplied relation, SQL, timestamp or search path is used. Production anon/authenticated/service_role cannot CREATE in public.
- Revoke function execution from PUBLIC, anon and authenticated; grant only service_role. Create/revoke/grant in a single transaction so there is no temporary public-execute window. Notify PostgREST to refresh the new RPC after commit.
- Retain the reviewed budgets unchanged: global 120/minute; identity 5/minute; client 20/minute when a trusted client hash exists. Database clock controls the fixed window; rows expire after two minutes and are cleaned on subsequent calls. No cron job is introduced.
- A transaction-scoped advisory lock serializes independent instances before reading database time/upserting counters. Global budget is checked first, bounding rotating-identity/client key creation. Saturating counters prevent unbounded integer growth. No raw Gmail, IP or password is stored.

## Bypass and availability review

The Edge Function computes canonical-Gmail HMAC bucket hashes; clients cannot choose hashes or supply their own budget timestamps. A stable server-only secret must be shared across instances. Dot/plus aliases map to the same Gmail identity. Rotating identities remains bounded by the global budget. Successful and failed password attempts both consume a budget before Firebase password proof; exhaustion skips password verification and returns 429. Missing limiter dependencies fail closed.

This limiter protects `authenticate_gmail`, not every direct Firebase password API. Student ID, institutional-email and native Firebase login routes retain their existing Firebase checks/throttling. There is no duplicate-account creation, password bypass or role change.

Optional IP limiting remains disabled unless `GMAIL_LOGIN_TRUSTED_IP_HEADER` is separately approved and proven to be overwritten by a trusted gateway. Do not enable it based on arbitrary client-forwarded headers. Identity/global controls do not depend on IP trust.

Fixed windows permit bursts across a minute boundary. Public callers can consume a victim's identity budget or the global budget, causing temporary denial of service. These are known availability tradeoffs, not a claim of DDoS prevention. Changing limits, adding gateway rules, or rotating the key requires a separate review. Applications must keep RPC transactions short; holding the shared advisory lock can stall other calls. A compromised service-role credential is outside the protection offered by this RPC.

## Secret preparation — no production secret generated or uploaded

`scripts/prepare-gmail-login-secret.py` uses Python's OS-backed `secrets.token_hex(32)`: 256 random bits encoded as 64 hex characters, compatible with the existing HMAC helper. It creates a new mode-0600 env file outside the repository, refuses overwrites/symlinks, and never prints or uploads its value. Unit tests use disposable local files only; no production candidate key was prepared.

After authorization only, choose a private path outside the repository and run:

```sh
python3 scripts/prepare-gmail-login-secret.py --output /secure/private/gmail-login.env
supabase secrets set --project-ref svgfxatigtjdrwzibjbu --env-file /secure/private/gmail-login.env
```

These commands have not been run against production. Configure ONLY GMAIL_LOGIN_RATE_LIMIT_SECRET; never include the existing Apps Script/provider/Firebase credentials in that file. Store the value in an approved secret manager, restrict file access, and remove the transient local file after verifying upload. Do not paste it into chat, CLI arguments, logs, source control or frontend configuration. Keep it stable across instances/deployments; do not regenerate it on each deploy. Recheck metadata immediately before configuration and stop if a key now exists rather than overwrite/rotate it.

## Apps Script and existing authentication compatibility

The version 21 Apps Script compatibility source at ea6c5e5 is unchanged on this branch. These prerequisites do not access provider configuration or delivery routines. Existing verification and recovery remain independent of the new HMAC key/RPC because credentials are evaluated lazily. Full regressions include provider-body production fingerprints, Apps Script signing/provider selection, student/officer verification/recovery and Student ID/institutional email login without a Supabase lookup. No live email was sent.

## Local test evidence

Use a labelled, network-isolated disposable PostgreSQL container; no host ports or production connection strings. Tests refuse any container without the expected local name, network=none and test label. PostgreSQL 17.6 matches the production major/minor version. The local service_role has BYPASSRLS to exercise the production privilege distinction.

- `npm test`: 277 passed.
- Gmail security/HTTP integration suite: 24 passed.
- `SSU_TEST_POSTGRES_CONTAINER=ssu-local-gmail-prerequisites node --test tests/gmail-rate-limit.postgres.integration.test.mjs`: 14 passed against real PostgreSQL.
- `python3 tests/gmail-login-secret.test.py`: 4 passed.

Database tests cover simultaneous independent connections and Edge authenticators, identity/client/global exhaustion, invalid credentials, a successful existing-UID Gmail login, window reset/expiry, malformed hashes, RLS/ACL/definer/search-path checks, migration reapplication preserving records, hostile-path isolation, and rollback/reapplication preserving an unrelated sentinel row. Secret tests cover format, private permissions, non-disclosure, refusal to overwrite, symlink refusal and repository-output refusal. The fixed thresholds were not weakened to pass tests.

## Exact production sequence — all mutations require approval

1. Read-only preflight: verify project, current source/version and metadata again; preserve rollback source and config. Confirm the required objects/key remain absent or stop to review conflicts. Confirm actual PR/commit identities. Keep production EMAIL_PROVIDER and Apps Script values unchanged.
2. **Approval required: apply only the reviewed migration**, in a transaction as the trusted postgres migration role. Do not use a general migration push, reset, seed or schema synchronization. No Facebook or other SQL is authorized. Check function signature, owner, fixed path, RLS and role privileges with catalog SELECTs.
3. **Approval required: generate/store/configure only the new secret** using the protected env-file flow. Do not rotate existing secrets. Verify presence/expected digest without printing the value.
4. **Approval required if desired: production technical-RPC smoke test** under service_role using synthetic HMAC keys. This writes only new limiter counters, including one global attempt; it performs no account lookup, password check or email. Do not perform it under a read-only authorization. PostgREST RPC visibility, rather than catalog existence alone, must also be checked.
5. **Separate explicit deployment approval required: deploy only usc-email**, using the exact reviewed compatibility package ea6c5e5 and explicit project ref. Include its imported helpers; preserve verify_jwt=false. No worker/facebook, database, secret, Firebase or Vercel changes are bundled into the function deployment. Stop if latest production source differs from the reviewed baseline.
6. Verify function version/status, CORS and rejection of anonymous administrator actions without modifying account data. Report failures and stop. Do not perform account removal as a deployment test.
7. **Separate test-email approval required:** nominate one controlled eligible verified Gmail, confirm limits and request exactly one recovery email through the normal flow. Successful delivery requires both apps-script acknowledgment/log correlation and inbox receipt; generic recovery success is not delivery proof. The expected recovery timestamp/counter and delivery-log writes must be included in that approval. Do not change the account password. No such test is authorized or performed now.

## Rollback and failure handling

A failed migration transaction rolls back new object/ACL changes. If secret setup fails, stop before Edge deployment; new unused SQL objects can remain while the failure is reviewed. If Edge verification fails, stop and report; no automatic further production changes are authorized.

Preferred authorized rollback restores the preserved version 21 usc-email source first, keeping existing provider secrets/configuration unchanged. That returns to its old behavior and removes dependency on the new limiter. Source/package hashes were verified in the prior readiness review. A rollback is itself a production deployment requiring approval; it does not reverse emails, account removals or prior data writes.

Leaving the unused new counter table/RPC and key is safer than immediate deletion and avoids affecting another consumer. If cleanup is explicitly authorized, first verify no updated function/other consumer uses them and that they were absent before this rollout. Then run only `supabase/rollback/202611030001_gmail_login_rate_limit.sql` in a transaction: it drops the exact new RPC and table, without CASCADE, discarding only new temporary counters. It preserves unrelated records; local rollback was tested. Unset only GMAIL_LOGIN_RATE_LIMIT_SECRET afterward if separately approved. Never delete unrelated secrets, accounts, Gmail mappings, delivery/audit logs or migration history. Existing prerequisites found at preflight must not be dropped as rollback.

## Remaining limits

Local PostgreSQL/IO tests do not verify production PostgREST cache/permissions, Edge runtime bundling, live Firebase account-update IAM or real inbox receipt. No isolated cloud staging exists. No production RPC has been executed, no key has been configured, and version 21 is still live. The global availability tradeoffs and real gateway behavior require operational review. The package is prepared for review; production is not ready to run the new Gmail login route until prerequisites are authorized and verified.
