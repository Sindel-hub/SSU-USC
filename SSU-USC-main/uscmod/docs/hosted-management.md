# Hosted Needs Assessment and Student Records

## Resulting architecture

The website calls its own `/api/management` endpoint. Vercel runs the Node.js backend on demand; Firebase Authentication and Firestore continue to hold identities and records. The existing survey/student-record service modules are reused. The Gmail SMTP adapter sends activation instructions from a dedicated notification account. A laptop, terminal, emulator process, Firebase Functions deployment, Resend account, or custom email domain is not required for this hosted path.

This does **not** upgrade Firebase Spark or bypass its quotas. Vercel plan eligibility/limits and Gmail account limits still apply. Gmail can reject, throttle, or suspend automated sending; this is not an unlimited bulk-mail service. The existing unrelated email/Facebook/Supabase modules and retired election services are not migrated or re-enabled.

The implementation is prepared locally. No GitHub push, PR, deployment, live secret, Firebase setting or student record was changed as part of this work. Real hosted Firebase and Gmail integration remain unverified until the explicit staging steps below are completed. The user's dedicated Gmail currently does not offer App Passwords; its cause has not been established. Never disable security protections to force this setup to work.

Officer assignments, historical records and automatic activity capture are described in [officer-administration.md](officer-administration.md). This dependent change also requires reviewed staging rules and the assignment index.

## Runtime and frontend boundary

- `api/management.js` exposes only 19 named management operations, not arbitrary Firebase functions or database paths.
- Protected requests send a Firebase ID token. The server calls `verifyIdToken(token, true)`, then checks the current approved/active profile, trusted role, administrator email verification and recent sign-in for student-record writes. Officer survey management also requires the existing `bulletin.manage` permission. A browser-supplied role/UID is never trusted.
- Public questionnaire, submission and activation calls need no login and omit authentication headers. They are narrowly validated by the same existing business modules. IP-based rate limits are stored under a keyed, opaque network identifier in the private `hosted_request_limits` collection; raw addresses are not stored. Existing survey retry protection, schedules, private responses and activation ticket checks remain in force.
- Requests require JSON, have a 1 MiB limit and accept only the documented action envelope. Browser origins are checked against configured origins, and no permissive CORS response is added. Cookies are not used for API authentication. Responses are not cached. App Check verification can be enabled separately and fails closed if its configuration is incomplete.
- Internal exceptions and SMTP diagnostics are not returned or logged with request bodies. Logs contain only a request ID and error code; tokens, passwords and credentials are excluded.
- `scripts/build-hosted.mjs` produces a public-only `dist` directory. The server, Firebase Functions source, tests, scripts, emulator exports, dotfiles, backups, SQL, private credentials and local setup files are excluded. Only the Supabase browser configuration is copied from the Supabase directory, never Edge Function/migration source.
- Firebase web configuration is injected into the public build and must match the backend project. Service-account keys and Gmail credentials are used only on the server. The build rejects private/unsupported fields in the web configuration and private-key material in public input.
- Preview configuration must use isolated staging Firebase, never the production project or production activation origin. Supabase is disabled and production Supabase HTTP requests are blocked in staging. Production preserves existing Supabase behavior. This means unrelated Supabase-backed settings/Gmail-login features cannot be tested in this isolated preview; use Student ID login for synthetic students.

## Required Vercel environment variables

Use Preview scope first. Do not set or change Production scope until the user separately approves the production deployment/configuration.

| Variable | Preview / staging value | Sensitivity |
|---|---|---|
| `USC_ENVIRONMENT` | `staging` | Configuration |
| `USC_FIREBASE_PROJECT_ID` | `ssu-usc-email-staging` | Configuration |
| `USC_FIREBASE_WEB_CONFIG_JSON` | The staging web app's public Firebase configuration as one JSON object | Public web configuration; never substitute a service-account JSON |
| `USC_FIREBASE_SERVICE_ACCOUNT_JSON` | A service-account JSON belonging to that same staging project | **Secret; server only** |
| `USC_PUBLIC_ORIGIN` | Exact verified HTTPS staging origin without a path/trailing slash, or omit to use the automatic `VERCEL_URL` | Configuration |
| `USC_GMAIL_USER` | Dedicated notification account's full `@gmail.com` address | Private server configuration |
| `USC_GMAIL_APP_PASSWORD` | Google-generated app password, not the account's normal password | **Secret; server only** |
| `USC_ENFORCE_APP_CHECK` | `false` initially; `true` only after registration and staging verification | Configuration |
| `USC_APP_CHECK_SITE_KEY` | Registered frontend App Check site key when enabled | Public site configuration |

Do not set `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` or `FUNCTIONS_EMULATOR` on Vercel; hosted initialization rejects them. Vercel Preview also rejects demo/emulator project IDs. Keep the Vercel root directory pointed at `SSU-USC-main/uscmod`.

`vercel.json` retains the existing redirects and adds the public build command/output directory, Node function duration and Singapore region. The package targets Node 22 and locks production dependencies. Vercel must build the public directory and bundle the Node API, not publish the entire repository as static files. These source changes do not apply any live Vercel settings before an approved deployment.

For Production, the explicit expected Firebase project is `universitystudentcouncil-856cc` and the canonical activation origin is `https://ssu-usc.vercel.app`. A production environment must not use staging credentials; a staging build must not use the production project. Never copy the Windows emulator testing configuration or helper files into the hosted source.

## Gmail setup, one step at a time

1. Create/designate a dedicated USC notification Gmail and keep its normal password private. The user has confirmed that this account exists.
2. Confirm 2-Step Verification is On. The user has confirmed Google Prompt and Phone/SMS methods. Those methods do not match Google's documented "security keys only" App Password restriction.
3. Visit Google's App Passwords page while using the dedicated account. Google currently displays "The setting you are looking for is not available for your account." Do not claim this cause is known or recommend disabling 2-Step Verification, Advanced Protection, or organization controls. Check Advanced Protection enrollment read-only next. If Google continues to block this method, evaluate a Google-supported alternative before deployment; the current adapter requires an app password.
4. Once available, generate a separate app password named `SSU-USC Vercel Staging`, save it in a password manager, and enter it directly as the **Preview** secret above. Never paste it in chat, a command line, the browser bundle, a screenshot or Git. The normal Gmail password will not work as this secret.
5. Do not send mail or test SMTP until configuration is approved and a controlled recipient is explicitly designated. Test with synthetic student records and a controlled mailbox, never an authorized list of real students.
6. Verify both provider acceptance and actual inbox delivery. A successful SMTP acceptance is not proof that the email reached the inbox. Timeouts/rejections remain visible as unconfirmed delivery; do not automatically retry. Explicit resend invalidates prior activation links.

The adapter uses Gmail's TLS SMTP connection on port 465, authenticates as the configured sender, and never accepts an arbitrary SMTP host/from address from the browser. No SMTP port on the user's computer needs to stay open. Existing Cloud Functions/Resend code remains an optional legacy path, not a hosted dependency.

## Staging verification before production

1. Verify the isolated staging Firebase project, its database edition and usable Firestore database. This workspace has not authenticated to that live project. Create a staging web app/config if missing. Spark remains unchanged.
2. Prepare a least-privilege server identity with Firebase Authentication administration and Firestore data access for staging only. Keep its private key in Vercel's server environment, never the source/public web config. If organizational policy prohibits service-account keys, resolve a supported hosted identity method with the administrator; do not bypass the policy.
3. Ensure staging Email/Password authentication and the required trusted role/profile exist. The API requires verified administrator email plus approved/active administrator profile and a trusted `admin` custom claim. Officer permissions and claims must be verified separately.
4. Verify the registration collection-group index from the earlier student-record change. No Firestore rule changes are needed for the new private rate-limit collection because existing default-deny rules apply. Do not redeploy unrelated rules/index/TTL settings without reviewing their scope.
5. Obtain explicit approval for the exact code before pushing or creating a PR. Configure only staging/Preview secrets and allow an approved Preview build. Verify its actual URL; never infer functional readiness from a green frontend build alone.
6. Test unauthenticated/invalid/revoked tokens, officer/student denials, recent-auth checks, private survey data, malformed payloads, origin restrictions and throttling using the hosted API. Verify a synthetic import, continuing-account preservation, actual Gmail delivery, single-use activation, student login, status-based access removal, history, anonymous survey submission and analytics. Refresh auth sessions before privileged writes.
7. Only after these pass, present the exact production credential/origin changes and deployment scope for explicit approval. The user performs the final merge. Do not upgrade Spark, deploy Firebase Functions, or import production records as part of staging tests.

No credentials or Gmail messages were used by the automated tests. They use in-memory Auth/Firestore doubles and a stub SMTP transport. The earlier Windows emulator test proved the old Firebase/Resend path locally; it does not prove this new Vercel/Gmail configuration works live.

## Local checks

- `npm test` includes hosted settings, authorization, JSON/origin/App Check checks, token/role failures, HTTP-to-service workflows, rate limiting, SMTP message construction, browser transport and public-build isolation tests.
- `npm run build:hosted` requires the public environment configuration above; it does not require exposing private keys to the build output. It intentionally fails if the deployment target is not specified or public configuration is unsafe.
- `node tests/browser/hosted-management.cjs` creates an isolated public build and exercises the actual browser client and HTTP route with synthetic Auth/Firestore/SMTP doubles. No real Firebase or Gmail connection occurs.
- API dependency tracing checks that both service modules, their models/catalogue and officer permissions are included in the server bundle. A real Vercel build/deployment remains a staging gate.

## Recovery and operations

The existing import journal handles interrupted account processing; completed rows are not provisioned twice. Preview and activation secrets remain separate from the Vercel Production environment. Reverting the frontend/API deployment restores the previous source but does not delete Firebase records, historical imports, or already created accounts. Keep database/account recovery separate and explicitly authorized.

Rate-limit counters have one keyed document per network/bucket and rotate their time window in place. No TTL or paid cleanup service is required for correctness; retention/cleanup of these opaque counters can be established by an authorized administrator. Gmail/provider quotas and Firebase/Vercel usage must be monitored before large-scale use.

Official references:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/plans/hobby
- https://support.google.com/accounts/answer/185833
- https://nodemailer.com/usage/using-gmail/
