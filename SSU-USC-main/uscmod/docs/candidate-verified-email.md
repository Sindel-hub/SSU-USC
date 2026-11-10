# Verified contact requirement for candidate applications (Task 3)

## Root cause

The old browser/callable submissions checked the election and candidacy approval but did not consult the verified Gmail mapping in Supabase or institutional verification. They copied an account/login email into a private application, which could be an internal login placeholder. The browser could directly create a registration through Firestore. Review actions saved decisions without a durable application-email event.

## Trusted submission and review

`supabase/functions/_shared/candidate-registration.mjs` defines the backend workflow. The adapter uses the existing `usc-email` Edge Function, Google-validated Firebase sessions, versioned Firestore reads/atomic commits, `student_email_accounts`, institutional account verification and the existing email worker/provider. No new verification mechanism, SQL email table or credential is introduced.

New authenticated actions: `candidate_email_status`, `candidate_submit`, `candidate_review`, `candidate_notification_retry`. Browser and Firebase callable submission/review paths use this same authority. Callable review retains its existing recent-authentication/permission gate. Existing Gmail login, recovery and provider implementation bodies remain unchanged.

Eligibility accepts one currently associated verified Gmail mapping (UID, requested/verified addresses and verification timestamp agree), or a verified institutional address in the account. The latter follows the existing institutional status authority: trusted profile verification or Firebase-verified native email matching that institutional address. An explicit institutional revocation marker fails closed. Arbitrary profile email text, client verification claims, pending/replaced Gmail mappings and disabled identities are insufficient. Existing verified personal Gmail remains the default notification recipient; existing preferred/primary fields are honored only when they match a verified contact. Transactional application notices do not depend on optional news/digest preferences.

Submission checks verification before uploads in the UI and again in the backend, including a fresh recipient check after attachment validation. It pins election/account identity, active pointer, lifecycle flags, window, duplicate status, attachment ownership/type, and versioned account/election/file records. The same request ID is idempotent. Event IDs hash account, election, submission generation and revision so separate elections never collide. Removed applications can be replaced only under the open-current-election rules from Tasks 1/2. Replacing an application clears legacy contact fields, while historical records/audits remain protected.

Direct browser creation or review of applications/publications is denied by Firestore rules. Existing audited history edits/soft deletions remain available. This prevents bypassing email checks or saving a review without its notification event. Trusted commits atomically save the application/status, outbox event and audit entry. No registration is created just to save a draft.

## Student progress and UI

A responsive native dialog explains Email Verification Required and offers Connect Gmail / Institutional Email and Cancel. Cancel preserves the current form. Connect saves text and private upload references to `candidate_registration_drafts/{uid}/elections/{electionId}` and opens the existing Profile drawer at its email section, leaving the form underneath. Attachment bytes stay in the existing access-controlled file store; no document bytes, mail tokens or credentials enter session/local storage. Only the non-sensitive Election ID is remembered in session storage; text and attachment references remain private in Firestore. A same-account reload restores a nonexpired draft for that election, including attachment references/names, position, platform and statement. UI drafts expire after 24 hours and are deleted after successful submission; no automatic asset deletion runs.

Return and submission revalidate current election/window/account/application state. A closed window or a different active Election ID shows an explanation and no draft submission action. Deleted submission nonces cannot be replayed; a new registration needs a fresh request ID. Verification is checked fresh without logout. Requests for information include a student-visible message and permit the existing application to be corrected during its review window, then returned to Under Review with a new revision/event. Original submission identity/date remain associated with that election.

## Delivery and retry

The existing secret-authenticated `usc-email-worker` processes `candidate_email_events` before its existing portal digest scan. Submission, approval, rejection and information-request events are created only by successful mutations; page reads/refreshes never send mail. Messages include candidate/election/position/submission date/status and explicitly student-visible guidance. Internal notes, documents, private URLs and verification tokens are excluded. Links open the authenticated Election page.

Workers atomically claim queued events by version before calling the unchanged provider. They re-resolve the recipient at send time; revoked/missing contacts fail without an unverified fallback. Competing workers cannot claim the same event. Sent events are not retried. Definite rejection or missing-recipient failures are marked failed and may be requeued by an authorized reviewer, with an audit entry. Each attempt increments its count. History shows queued/sending/sent/failed/unconfirmed/cancelled and offers Retry email for confirmed failures.

A timeout, lost provider response, worker interruption or failed sent-state persistence can leave delivery uncertain. These events become unknown (stranded sending claims are marked unknown after ten minutes) and cannot be blindly retried. An administrator must reconcile the provider first. This deliberately avoids promising exactly-once delivery across a nontransactional email provider; it prevents automatic duplicate sends after ambiguous failures. No delivery failure reverses the saved application/review. Old-generation/deleted applications and obsolete information requests are cancelled. Earlier confirmation/decision events remain associated with the same generation even if its review advances.

## Privacy and compatibility

New applications/events/publications do not copy notification addresses. Only the backend resolves verified contacts. Publications use an explicit public field projection; browser publication creation is disabled. Applications/history remain own-student or approved-officer/admin data. Outbox events contain no recipient address and have own-student/officer read access, no browser writes. Supporting documents and drafts remain private. New upload metadata omits ownerEmail; old candidate-photo metadata containing email fields is not readable by other students.

**Legacy privacy dependency:** before rolling rules to staging/production, audit old candidate-photo metadata for ownerEmail/email and redact those contact fields through an authorized backend operation, retaining ownerUid and all file bytes/chunks. Until redacted or reuploaded, old photos may show a fallback to other students and cannot be reused for new submission. Review legacy public candidate documents for unexpected contact fields as well. This task does not mutate any live documents or perform that migration. Existing private application email fields remain private historical information, not copied into publications or mail events.

## Modified components

- Shared candidate-email popup/draft helper and stylesheet; student Election HTML/JS.
- Existing Profile drawer event to open its email settings.
- Officer Election public-message/request-information actions and history delivery badges/retry.
- Security client and callable functions routing to the shared trusted workflow.
- `usc-email`, `usc-email-worker`, new backend workflow/adapter, versioned Firestore workflow helper.
- Firestore rules for trusted submissions/reviews, private drafts/outbox and photo metadata privacy.
- Backend, browser and emulator tests; existing scope/history rule tests now submit through a privileged adapter of the actual backend workflow rather than the deliberately retired browser-write path.

## Validation and deployment gate

Tests use synthetic accounts, fixtures and demo Firestore emulators. No production student records are used and no real candidate emails are sent. Commands: `npm test`, `npm run test:candidate-email-browser`, `npm run test:registration-history-browser`, `npm run test:candidate-email-rules`; also run scope/history/candidate-management emulator suites and Deno-check both Edge Functions.

The user previously confirmed **no isolated staging Firebase project exists**. Backend code is prepared and locally verified, but the frontend Preview is not a fully configured end-to-end staging environment. The current deployed email service will not recognize the new actions until a coordinated backend rollout. Treat it as UI/code review only and do not test mutations using production students.

Before end-to-end review: provision isolated staging Firebase/Supabase, configure the Preview client and email endpoint override for them, configure existing Firebase IAM/email/worker secrets for staging, perform the legacy privacy audit/redaction in staging, deploy matching usc-email + usc-email-worker (and callable proxies if used), apply rules, and verify synthetic lifecycle/delivery/recipient-revocation/retry scenarios with a controlled staging recipient. No new SQL migration/index is needed; root outbox state/UID queries use default single-field indexes. Confirm the worker scheduler calls the updated worker. Reconcile review summaries if an election has 490+ applications or a version conflict exhausts summary retries; the saved review/email event is retained and publication stays locked.

Production backend updates need separate explicit authorization. Deploy backend/rules/client together; cached clients using direct registration writes must refresh. Do not weaken the rules to roll back or to bypass missing backend setup. Leave the PR unmerged for the user's manual GitHub review/merge after staging acceptance. Rollback the client/Edge deployment as a coordinated release while preserving application/audit/outbox records; reconcile sending/unknown events with the provider before any resend.

## Follow-up: email display and deployment mismatch

The registration personal-information and private review screens now load the authenticated
`candidate_email_status` response instead of reading basic login/profile email text. This
response includes only the calling student's selected verified contact. Unverified contacts
are never displayed as verified. Each render, profile update and window focus refreshes the
status; detached fields and changed sessions cannot receive stale responses. No addresses
are added to application, outbox, or public candidate documents.

A 400 `Unknown email-service action.` for candidate actions is reported as a service update
requirement, not as an unverified email. Submission remains blocked and the open form is
preserved. Other email actions and actual verification rejections retain their existing errors.
This message does not replace the required backend deployment.

Deployment checklist for the separately authorized backend rollout:

1. Deploy this branch's `usc-email` and `usc-email-worker` together to isolated staging,
   with their existing Firebase and email provider settings. Apply the matching rules.
2. Verify authenticated `candidate_email_status` returns `{ok:true,verified,source,email}`
   for synthetic Gmail-only, institutional-only and unverified students. A pending contact
   returns `verified:false` and an empty address. Another UID cannot be selected by payload.
3. Exercise submission, each review outcome, draft restore and notification delivery through
   the existing secret-authenticated worker scheduler. Use controlled staging recipients.
4. Review public candidate documents and photo metadata for legacy email fields.
5. Only after separate production authorization and restored Supabase management access,
   deploy the same tested Edge Functions to production and verify its scheduler and secrets.
   The Vercel frontend deployment alone cannot update Supabase functions.

During this follow-up, the configured Supabase management credential returned HTTP 401.
No production Edge Functions, rules, records, scheduler or provider settings were changed.
