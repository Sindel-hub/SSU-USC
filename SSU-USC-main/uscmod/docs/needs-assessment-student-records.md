# Needs Assessment and Student Records — implementation and setup

This change extends the existing HTML/JavaScript, Firebase Auth/Firestore, and Supabase Edge Function architecture. It does not replace the application or integrate with Registrar systems. Work is local on `feat/needs-assessment-student-records`. Nothing has been pushed or deployed.

## Implemented behavior

- Officer navigation and student navigation now open Needs Assessment. The student dashboard links to available questionnaires. Legacy election source, routes, stored data and participation history remain preserved for compatibility; this is not an election-data deletion or migration. Legacy election APIs are not removed in this change.
- Survey builder: title, description, instructions, department targeting, local-time schedule entry, question editing/reordering/removal, required/optional questions, choice, checkbox, short/long text, and ratings from 1–5. Save draft, publish, close and archive; scheduled/active/expired status is derived from trusted server time. Published questions and schedules are immutable.
- Published surveys have stable internal `/survey/index.html?id=...` links. Officers can copy links and select a published survey in the existing Bulletin Board composer. Existing public landing, dashboard, bulletin and officer readers show a Take Survey link. Ordinary announcements still work if the management endpoint is unavailable.
- Public survey list and questionnaire require no login. Server validates availability, department, answer types/options, required fields, lengths and duplicate keys. Responses and counters are committed together. There are no seeded statistics in application code.
- Analytics use saved responses: department totals, question frequencies and percentages, ratings, open text, most-selected findings, privacy-filtered submission days, CSV summaries, and browser Print / Save PDF. No PDF library or spreadsheet export dependency is added to the frontend.
- Student import accepts CSV/XLSX with a server-generated preview, validation, new/existing/unchanged/invalid/conflicting classifications, duplicate detection, exact Student ID matching, confirmation and resumable row transactions. Limits: 5,000 rows and 5 MB per file. Validated plans use small Firestore chunk documents; applying a row, its history, audit entry and progress marker is atomic.
- New imported students receive passwordless, disabled Firebase Auth records with a trusted Student claim and pending portal profiles. No temporary passwords are generated for this new workflow. Existing manual registration remains compatible.
- Administrators issue 24-hour, single-use activation instructions by configured email, or privately after checking identity in person. Activation sets the student's chosen Firebase password and updates portal status. Academic enrollment and account activation are separate. Activation links are not included in import reports, audit records or browser URLs after loading the activation page.
- Annual updates preserve UID, previous academic information and existing service participation. Missing records are flagged only when the administrator explicitly marks the upload as a complete university list. Absence never automatically graduates or deactivates a student. Reappearing verified records clear the review flag. Older academic years cannot overwrite newer current records.
- Student directory supports ID/name search and department/program/year/academic-year/status filters, profiles, activation state, academic history, existing event/program registrations and complaint submission references. Anonymous survey responses are never joined to student profiles.
- Existing administrator audit logs receive timestamp-compatible entries for imports, status changes and activation issuance. No browsing surveillance is introduced.

## Access and privacy

`needs.manage` is a new explicit officer permission, assignable through the existing User Directory permission editor. Existing election permissions are retained; they do not automatically grant this new permission. Administrators can manage both modules. `bulletin.manage` permits published-survey metadata selection. Student records, imports and activation issuance require both the trusted Firebase administrator claim and an approved, active administrator profile. Public actions never expose student records or private responses.

New Firestore collections are denied to browser SDK clients. All writes go through the server with version/create-only preconditions. Anonymous submissions use a per-survey browser-generated idempotency key and a honeypot; a durable HMAC-of-ingress-IP bucket permits at most 60 distinct submissions per survey per hour. Activation attempts use a separate bucket. No raw IP or browser nonce is stored with answers. The gateway must overwrite trusted ingress headers; confirm this during staging verification. Shared networks may hit the rate cap, and it does not establish identity or prevent determined distributed spam.

Department, identity and enrollment cannot be verified for anonymous respondents. Local duplicate suppression can be bypassed by clearing browser storage or using another device. The UI clearly asks respondents to omit identifying details. Groups with fewer than five responses are excluded from question analytics, including the all-department aggregate. Small department counts and small daily counts are suppressed; open text has no per-response timestamp or account identity. Exact overall response totals are still visible to authorized officers.

## Routes

| Route | Purpose |
|---|---|
| `/usc-admin/needs-assessment/needs-assessment.html` | Officer survey builder, library and reports |
| `/survey/list.html` | Public available/scheduled questionnaires |
| `/survey/index.html?id=SURVEY_ID` | Public questionnaire |
| `/survey/activate.html#token=PRIVATE_TOKEN` | Student activation; fragment is removed immediately |
| `/usc-admin/student-records/student-records.html` | Administrator import and record management |
| `/usc-admin/student-records/student-import-template.csv` | Sample import template |

## Server endpoint

`POST /functions/v1/usc-management` accepts JSON `{ "action": "...", ...payload }`. Private calls send a Firebase ID token in `x-firebase-token`; the server validates it with Google and checks the current trusted profile. Supabase JWT verification is disabled for this function because its public actions intentionally accept anonymous requests; this does not bypass private Firebase authorization.

| Actions | Access |
|---|---|
| `surveys_available`, `survey_public`, `survey_submit`, `activate` | Public; action-specific validation and submission/activation protections |
| `survey_list`, `survey_save`, `survey_state`, `survey_analytics` | Administrator or assigned `needs.manage` officer |
| `survey_links` | Administrator or assigned `bulletin.manage` officer; published metadata only |
| `students_list`, `student_detail`, `student_status` | Administrator |
| `import_preview`, `import_preview_details`, `import_apply`, `import_history` | Administrator; only the preview's creating administrator can apply/resume it |
| `activation_issue` | Administrator; email delivery or explicit in-person identity-check confirmation |

The endpoint uses the existing trusted Google REST adapter. Auth creation and custom-claim assignment are separate requests because Firebase's create endpoint does not support `customAttributes`. Auth UIDs are deterministic hashes of Student IDs, allowing safe recovery if Auth creation succeeds before a Firestore row fails. A pending orphan Auth identity is disabled and cannot access the portal; retry the import instead of deleting unrelated accounts.

## Firestore schema and migration

There is no SQL migration and no destructive backfill. Required source rules changes must be reviewed and applied to isolated staging first; they have not been deployed.

| Collection/path | Data |
|---|---|
| `needs_surveys/{id}` | Embedded question definitions/options, schedule, target department, lifecycle, response count, creator and timestamps |
| `needs_surveys/{id}/responses/{id}` | Anonymous department, validated answers, submission time; no UID or Student ID |
| `needs_submission_keys/{hash}` | Survey idempotency marker |
| `student_imports/{id}` | Preview state, counts, academic year, creating administrator, resumable cursors and expiry |
| `student_imports/{id}/chunks/{id}` | Immutable validated row/version snapshots and absence-review snapshots |
| `student_academic_history/{id}` | Same Student ID/UID, previous/current academic values, actor, import and timestamp |
| `student_activation_tokens/{hash}` | UID, expiry and ready/consumed state; raw token is not stored |
| `management_rate_limits/{hash}` | Durable counters and expiry; no raw IP |

Existing `users`, `school_accounts`, `student_masterlist`, `student_id_claims`, `login_aliases` and `audit_logs` are reused. Academic year, review flags and activation state extend existing records. Existing enrollment/status fields retain their meaning. New Student IDs use the existing numeric-string format of 1–64 digits; leading zeros are retained. Hyphenated IDs in the request's illustrative example are not enabled because they conflict with the existing login/claim/rule architecture.

No new Firestore composite index is needed for the current bounded reads. Existing election data is untouched. Rate-limit/expired-preview/token cleanup must follow an agreed retention policy; no automatic deletion policy is introduced. Both Firestore rules and the server's active-role checks remain necessary.

## Isolated staging configuration — not performed

1. Prepare separate staging Firebase and Supabase projects with synthetic users. Do not use production student records.
2. In the staging application's configuration, before any Firebase module runs, supply `globalThis.USC_FIREBASE_CONFIG` with the staging Firebase **public** web configuration (`apiKey`, `authDomain`, `projectId`, `appId`, and other public SDK fields). The new hook preserves existing default values when unset, and rejects invalid overrides before initialization. Never put service-account JSON or provider secrets in browser files.
3. Set `globalThis.USC_MANAGEMENT_FUNCTION_URL` to the staging project's `https://PROJECT.supabase.co/functions/v1/usc-management`. It defaults to an empty string, so new management operations fail closed with setup guidance until configured.
4. Configure staging Edge Function secrets: `SUPABASE_URL`, the existing server-side Supabase secret/service-role key, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `PORTAL_URL`, and a fresh random `MANAGEMENT_RATE_LIMIT_SECRET` of at least 32 characters. `PORTAL_URL` must be the reviewed staging site for activation links.
5. Use the existing approved email-provider setup if sending activation email. The shared email service supports its existing providers; missing delivery settings must be resolved or use in-person issuance. Email is issued from each pending profile after import, not sent silently to every imported address.
6. Prepare the `usc-management` Edge Function using the application source tree, including its imported shared models, permission definitions and program catalog. Verify bundling, runtime support for pinned ExcelJS 4.4.0 and unzipper 0.10.14, and Google IAM permissions in staging. The Deno check and workbook tests pass locally, but a deployed Supabase runtime has not been verified.
7. Apply reviewed Firestore rules in staging. Create approved staging staff profiles/claims using the existing administrator setup, and assign `needs.manage` through User Directory. Do not weaken authentication or expose new collections directly to the browser.
8. Verify all listed workflows against staging persistence, actual gateway ingress headers, real email delivery where enabled, privacy suppression and unauthorized requests before treating the feature as ready for use.

No GitHub push, PR, Vercel Preview, remote configuration change or deployment is authorized by these instructions. Obtain the user's approval of the exact reviewed changes first. The user retains the final merge action; production backend updates require separate approval.

## Officer workflow

Open Needs Assessment → Create Survey → add/reorder questions → target department and schedule → Save Draft → review → Publish → Copy Survey Link. In Bulletin Board, choose the published survey and publish the existing announcement normally. The public reader shows Take Survey. Reopen the library/results to refresh response counts and analytics. Close or archive the survey to stop submissions.

## Annual import workflow

Download the template and replace its sample row with authorized data. Use exact catalog department/program values, text-formatted IDs, one academic year, and supported student statuses. Upload → inspect every classified row and summary → correct conflicts/invalid rows → explicitly confirm → apply. Twenty atomic row/absence operations are processed per request; the UI continues until complete. If interrupted, Import History → Review / Resume shows the original preview and requires confirmation again. Preview expiry is one hour; a changed record requires a new preview. Completed rows remain applied and are not rolled back or duplicated.

For a partial file, leave the complete-university-list checkbox unchecked. Confirm it only when the file truly represents the complete verified list. Files larger than 5,000 rows must use partial imports; combining multiple files into one annual absence-review cycle is not implemented. Review flagged students individually. Activate pending accounts through verified-source email or in-person identity verification; do not share activation links through public announcements or reports.

## Limits and remaining verification

- Firestore emulator integration/rules tests are blocked by the emulator JAR download returning HTTP 403. Transactional behavior is tested in an isolated versioned store, and Firebase Auth is verified separately against its real local emulator.
- Deployed Supabase/Firestore persistence and email-provider delivery have not been exercised. The endpoint remains unconfigured. There is no verified Vercel Preview URL.
- Interactive reads fail explicitly beyond 500 surveys, 10,000 responses per survey/student-record dataset, or 1,000 import histories, instead of presenting truncated analytics as complete. Larger datasets need pagination/background export work.
- Imports are resumable per row, not one transaction for an entire year's records. Reports disclose processed/new/updated/unchanged/invalid/duplicate/flagged counts. New previews are required for stale conflicts or expiry.
- A provider failure after an activation token is consumed requires an administrator to issue a new link. Portal approval remains pending if the final database update fails. No token can be reused.
- Existing email changes and suspended/inconsistent/removed accounts require the established account-management workflows; imports cannot silently reassign identity or reactivate suspended accounts.
- XLSX dependencies emit deprecation notices for some transitive packages. Workbook input is restricted by compressed size, actual streamed expanded size, entry count, worksheet dimensions, plain-text Student IDs, and rejection of formulas/error cells. Node emits the repository's existing module-type inference warning; the package module system was not changed.

## Validation commands

- `npm test` — existing project checks plus the new management/config tests.
- `node tests/browser/management.mjs` — Chromium UI workflow and desktop/mobile overflow checks with isolated transactional fixtures and stubbed sign-in. Screenshots contain synthetic test records only; this is not live-backend verification.
- `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node --test tests/management-auth.emulator.test.mjs` — real local Firebase Auth provider integration; the test rejects non-local hosts and uses only `demo-ssu-management`.
- `deno check supabase/functions/usc-management/index.ts` — use an isolated Deno config/cache with npm auto-install if the local Node package manifest is otherwise selected.
- `deno test --allow-read --allow-env --allow-sys tests/management-workbook.test.ts` — CSV/XLSX parser and archive limits. The Node-compatible workbook dependency reads the process umask during module loading.

The companion review document lists every changed file, visual previews, exact validation results and the full patch.
