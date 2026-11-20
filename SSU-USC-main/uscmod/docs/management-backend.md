# Needs Assessment backend — staging package

The backend extends the existing Supabase Edge Function and Firestore architecture. It does not introduce another application, replace Firebase authentication, or move student data into a new database.

## Current target and access

The requested staging name is **ssu-usc-email-staging**, under the **University Student Council** Supabase organization. The connected account was checked: it currently exposes only the existing live project (`svgfxatigtjdrwzibjbu`) and no development branches. No accessible staging project with the requested name was found.

Supabase's project-cost tool quoted **$0 per month** and the organization reports the **Free** plan. Proposed new project region: **Singapore (`ap-southeast-1`)**. This is a proposal for review, not a record of resource creation. No project, deployment, migration, secret, GitHub push or Vercel setting has been created/changed by this backend revision.

Firebase staging credentials are not supplied in this execution environment, and the Firebase connection is not yet confirmed. An isolated Firebase project/public Web App configuration and its server-side service account are still required. A Supabase display name is not its project reference; the actual reference must come from the created/selected staging project.

## Backend changes

- `http.mjs` is the actual HTTP request handler used by the deployed listener. It validates JSON/content type/body limits and action names, authenticates private requests through the existing Google token verifier, checks administrator access before parsing imports, and applies the existing survey/import service.
- Cross-origin requests are restricted to the configured staging portal origin. Public questionnaires still require no login. Private requests require Firebase ID tokens and the existing current-profile/permission checks.
- The backend additionally checks that a Google-verified Firebase token's audience and issuer belong to the selected staging Firebase project.
- Configuration validation rejects the existing production Firebase/Supabase IDs, mismatched service-account project IDs, short network-protection secrets, malformed staging URLs and unexpected OAuth token endpoints. Invalid configuration returns HTTP 503 with a user-readable message rather than accepting writes or exposing secrets.
- `GET /functions/v1/usc-management/health` checks the Firestore database metadata using the server identity. It returns storage `reachable` only after that request succeeds, and `unavailable`/503 otherwise. Successful probes are cached for 30 seconds. This checks database connectivity, not email delivery or every Firestore rule.
- `prepare-management-backend.mjs` creates a self-contained Supabase functions tree. All shared models, permissions and catalog imports are placed inside that tree, so a deployment does not depend on files outside the uploaded function package. A SHA-256 source manifest is included.
- Optional generated **public** frontend configuration appends staging values after the existing defaults, so the management URL is no longer reset to an empty string. It selects the matching Firebase staging configuration and Supabase staging endpoints. Private/service-account credentials are rejected from the public input.

The survey lifecycle, validation, analytics, student ID matching, versioned Firestore commits, academic history and activation service remain the existing implementations. The new HTTP integration and packaging connect and prepare those implementations; they are not a mock service.

## Prepare the package locally

From `SSU-USC-main/uscmod`:

```sh
node scripts/prepare-management-backend.mjs --out /tmp/ssu-management-package
```

The output must be a **new directory outside the application source**. Existing directories are not overwritten. This command only writes local files; it never deploys or invokes cloud APIs.

The output contains:

- `supabase/functions/usc-management/index.ts`, its HTTP/config/Auth/workbook/service modules and copied application models/catalog.
- `supabase/functions/_shared/usc-email-common.ts` for the existing trusted Google/Firestore/email adapter.
- `supabase/config.toml` with only the management function's configuration.
- `deno.json` for npm dependencies and a `manifest.json` with source hashes.

Validate the **packaged** entry point with Deno, not just the repository source:

```sh
deno check --config /tmp/ssu-management-package/deno.json /tmp/ssu-management-package/supabase/functions/usc-management/index.ts
```

When using the Supabase deployment tool, include every manifest file and the output's `deno.json`. Use the exact entry point `supabase/functions/usc-management/index.ts`. Supabase JWT checking for this function is false because public survey actions intentionally allow anonymous requests; the body still performs Firebase verification and authorization for private actions. Do not change any other existing function.

## Staging server configuration

The source template is `supabase/functions/usc-management/.env.example`. Keep filled values in secure environment settings or an untracked private file outside the static site. Never paste private keys into chat, commit them, or put them in the frontend package.

Required server variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Actual isolated staging project URL; supplied by Supabase on hosted functions |
| `FIREBASE_PROJECT_ID` | Separate staging Firebase project ID |
| `FIREBASE_WEB_API_KEY` | Matching public Firebase Web App key |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Staging-only service identity JSON with appropriate Auth/Firestore permissions |
| `PORTAL_URL` | The approved preview site's HTTPS origin; also used for activation links and allowed Origin |
| `MANAGEMENT_RATE_LIMIT_SECRET` | Random secret of at least 32 characters; never a public API key |

Existing email-provider settings are only required for email activation. In-person issuance after identity verification remains available without them. Do not copy production email credentials or send messages to real student accounts for testing.

A local configuration preflight accepts environment variables and prints only non-secret target metadata:

```sh
node --env-file=/private/path/management.env scripts/prepare-management-backend.mjs --check-env
```

This validates configuration consistency; it does not prove that Google IAM or live email delivery works. The health endpoint and end-to-end staging tests must still be run.

## Prepare the frontend connection

Copy `config/management-staging.public.example.json` to a private working location and fill in the **actual public values** after the staging projects exist. Keep its `projectName` set to `ssu-usc-email-staging`. The example intentionally has blank project reference, publishable key and Firebase fields so no fabricated endpoint is enabled.

```sh
node scripts/prepare-management-backend.mjs \
  --out /tmp/ssu-management-connected-package \
  --public-config /private/path/management-staging.public.json
```

The additional output files are `frontend/shared/app-config.js` and `frontend/supabase/supabase-config.js`. These are reviewed staging replacements for the corresponding public application files, not a deployed site or a complete static-site copy. The generated management URL is `https://ACTUAL_PROJECT_REF.supabase.co/functions/v1/usc-management`.

Do not enable these frontend replacements until the staging backend is deployed, its health check succeeds, and its identity/database flows are verified. Stage the generated changes for a separate exact diff/review before committing or pushing. Neither generating them nor a healthy backend grants approval to change Vercel settings or publish unreviewed source changes.

## Required deployment order after approval

1. With explicit approval, create/select the named free Supabase staging project and wait for `ACTIVE_HEALTHY`. Never use the existing live project as a substitute.
2. Verify/select a separate staging Firebase project. Configure Authentication/Firestore and synthetic approved administrator/officer/student profiles using the established setup. Apply the previously reviewed Firestore rules to staging only when authorized.
3. Set staging-only server secrets in secure Supabase settings. The connected Supabase tools can deploy functions but do not currently expose a secret-setting operation; secure dashboard/CLI access may still be needed for that step.
4. Prepare and review the actual target package, deploy only `usc-management`, and verify `/health` against the real project. Do not represent a deployment with missing secrets as a working backend.
5. Test officer draft/publish/close, anonymous answer validation/counts, private-data denial, imports/history and activation with synthetic staging records. Validate gateway overwriting of `x-forwarded-for`; the rate limiter must not trust a user-supplied address in JSON.
6. Generate/review the matching frontend public configuration; commit/push only after approval. Verify the exact Vercel preview commit and API requests. Leave final merge to the user. Production backend changes need separate authorization.

## Local validation and remaining limits

The Node HTTP suite starts a real local HTTP listener using the production request handler and exercises publication, anonymous submission/idempotency and private analytics with an isolated transactional fixture store. It also tests rejected origins, unauthorized import parsing, health probe failures, malformed requests, staging identity validation and error sanitization. These HTTP integration tests are not live Firestore persistence verification.

The packaging suite verifies the entire local import closure stays inside the uploaded functions tree, rejects server credentials/production targets in public configuration, and executes generated frontend configuration to prove staging values override empty defaults.

The packaged Deno entry point is type-checked and booted locally without cloud secrets. Its real health and catalog endpoints must return HTTP 503 when unconfigured. No fake working backend or placeholder survey results are enabled.

The previous Firestore emulator download remains blocked by network policy. Live staging persistence, actual service-account IAM, email delivery, Supabase runtime deployment and the frontend-to-staging connection cannot be claimed until the staging resources/access above are available.
