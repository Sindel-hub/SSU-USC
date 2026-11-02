# usc-email version 21 compatibility review

Target: `svgfxatigtjdrwzibjbu`, function `usc-email`. This patch is for review only. It does not deploy functions, alter secrets, change authentication settings, or touch production records, Firebase rules or Vercel configuration.

## Verified source and scope

The deployed version 21 source was downloaded using authenticated Supabase CLI access into an isolated directory, rather than inferred from the repository. Function metadata was rechecked and still reported version 21, ACTIVE, verify_jwt=false. The public project reference matches both website email-service endpoints. Retrieved-file SHA-256 fingerprints and provider-body fingerprints are recorded in tests/fixtures/usc-email-v21-provenance.json. No runtime secrets were read or included.

The review branch starts from reviewed commit b8dd974069fa2fdaa497a0d65e84c7425d1ba0f5. The only runtime source changed by this compatibility patch is supabase/functions/_shared/usc-email-common.ts. Supporting changes are automated tests, provenance, test wiring and this document. The usc-email handler, Gmail-login module, account-removal module and institutional-account module remain exactly as reviewed. The institutional-account module also matches production version 21 byte-for-byte.

A persistent local rollback copy with canonical import paths is retained outside Git at /workspace/ssu-usc-backups/usc-email-v21. The original extracted download is also retained. Preserve that backup if replacing the workspace; no deployment has used it.

## What direct deployment of b8dd974 would change

| Version 21 behavior | Direct b8dd974 deployment | Compatibility patch |
| --- | --- | --- |
| EMAIL_PROVIDER selects apps-script or resend, case-insensitive; default resend | Provider selection is absent; sends through Resend only | Original selection and default preserved |
| Apps Script /exec URL and 64-character hex secret validated before sending | Apps Script sender absent | Original checks preserved |
| UTF-8 payload base64; version, timestamp, random request ID and body HMAC-SHA256 | Signed Apps Script protocol absent | Original body signing, content and acknowledgment contract preserved |
| Optional kind argument, default transactional | Optional argument absent | Original signature/default preserved |
| 60,000-byte limit, 25-second timeout, redirect following | Apps Script protections absent | Original behavior preserved |
| Valid response must confirm ok and matching apps-script request ID | Apps Script acknowledgment absent | Original confirmation and sanitized errors preserved |
| No automatic retry or provider fallback after uncertain delivery | Apps Script would be bypassed altogether | No duplicate-send fallback introduced |
| Provider credentials validated only when that provider sends | env() eagerly requires Resend credentials even for settings/Firebase operations | Original lazy provider-specific validation preserved |
| Existing Resend request, sender, response and error handling | Resend becomes mandatory | Existing Resend behavior preserved exactly |

After stripping types and normalizing formatting, the compatibility helper differs from deployed version 21 only by the three reviewed additions: firebasePasswordIdentity, gmailRateLimitHash and disableFirebaseAuthAccount. The bodies of env, sendAppsScriptEmail and sendEmail retain byte-for-byte version 21 fingerprints, apart from typed parameter declarations outside their bodies. All other existing helper behavior is unchanged.

The normalized version 21 versus reviewed handler comparison shows only the reviewed new account-removal/Gmail-authentication routes and wiring, plus verification wording explaining password login. Existing verification-token checks, duplicate-Gmail checks, role routing, recovery eligibility and cooldown/daily sending limits, settings, Gmail removal, password-change notices, institutional verification and administrator password-reset paths remain. The previously unsupported public resolve_gmail_login action is explicitly denied with 401; it is not an identity lookup. These reviewed changes are retained, not reverted by the provider restoration.

## Regression coverage

Tests run the real provider helpers and Edge handler using intercepted IO and synthetic identities/secrets. Coverage includes provider selection, Resend default, Apps Script UTF-8/HMAC protocol, default and explicit kind, timeout/size/configuration checks, acknowledgment mismatch, malformed responses, provider failures, no retry/fallback, lazy credentials, institutional verification delivery callback, actual student/officer Gmail verification and recovery, password-change notices, cooldowns, unavailable recovery and audit behavior. Provider bodies are also checked against retrieved production-source fingerprints.

Run `npm test` and `node --test tests/gmail-password-security.test.mjs tests/verified-gmail-http.integration.test.mjs`. No real email or production account is used. Passing intercepted-provider tests verifies code compatibility; it does not prove live inbox delivery.

## Deployment prerequisites and approval

Do not deploy until the user explicitly approves the compatibility patch and exact commit. Before deploying, recheck that the target is svgfxatigtjdrwzibjbu and compare against the latest deployed source. If version 21 has changed, stop and review that source rather than overwrite unreviewed functionality.

Deploy only usc-email with its imported modules and shared helper. Do not deploy usc-email-worker, usc-facebook, database migrations, secrets or unrelated resources. Preserve the current verify_jwt=false setting; Firebase sessions continue to be verified by the existing function code. Do not change EMAIL_PROVIDER, Apps Script settings, Resend settings, Firebase service-account settings or any other secret.

The reviewed Gmail password-login feature separately depends on the consume_gmail_login_budget SQL function and GMAIL_LOGIN_RATE_LIMIT_SECRET. Their production readiness is not established by this source comparison and this patch does not install or change them. Missing prerequisites fail closed; existing settings, verification and recovery do not require those new credentials. Account removal retains the separately reviewed Firebase-rule and account-update permission requirements. Do not change production configuration or data to resolve missing dependencies without authorization.

## Post-approval verification and rollback

After an authorized deployment, verify the new function version/status, CORS/OPTIONS and that an anonymous account-removal request is rejected before touching records. Confirm other function versions and authentication settings remain unchanged. No anonymous request should perform a real account removal.

To verify actual Apps Script delivery, use a controlled owner-approved email flow and confirm both a successful apps-script provider ID in the delivery log and receipt in the designated test inbox. Do not use arbitrary student data, expose recipient details/secrets, or treat generic recovery success as delivery proof. If a safe test mailbox or access is unavailable, report live delivery as unverified. Stop on any failed check; do not retry ambiguous sends, switch providers, change secrets, or make further production changes without authorization.

If verification fails, stop and report it. A rollback can redeploy the preserved version 21 source only after authorization; do not perform it automatically, alter secrets, recreate Gmail mappings or enable removed accounts. Historical records and audit logs must remain intact.
