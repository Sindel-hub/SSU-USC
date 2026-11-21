# Needs Assessment

This module replaces retired election dashboard access with anonymous surveys. It does not restore student-record import/activation or the removed Supabase management backend. Existing election records and legacy services are untouched.

## Usage

1. Open Needs Assessment from any officer module sidebar or module search.
2. Officers with the existing `bulletin.manage` permission can create a draft, add up to 30 questions, select departments, and set opening/closing dates in their local timezone. Other active officers can view surveys and reports.
3. Save, then publish. Publication locks questions, departments, and schedule so responses remain comparable. Duplicate a survey to revise it. Close early or archive closed surveys/drafts without deleting responses.
4. Copy the generated link or choose Attach to announcement. The Bulletin Board composer prefills the internal survey link; the officer still supplies and confirms the announcement. Attachment validates that the survey is published and available. Existing announcements without a survey behave unchanged.
5. Student Bulletin Board, dashboard announcement modal, and public home announcement modal show a Take Survey button. The public `/survey/index.html?id=...` questionnaire has no authentication guard. No account or email is requested.
6. Officers use View results, a department filter, response listings, summary/response CSV exports, or Print summary / Save PDF. Refresh includes newly submitted responses. CSV exports escape spreadsheet formulas. Multiselect counts can exceed response totals. Reports reflect submitted responses, not a verified enrollment-based participation rate.

## Backend and data protection

Five Firebase callable endpoints are exported from `functions/index.js`: `needsAssessmentManage`, `needsAssessmentList`, `needsAssessmentResponses`, `needsAssessmentPublic`, and `needsAssessmentSubmit`. The dedicated client calls them directly and never falls back to browser writes.

- Private collections: `needs_assessment_surveys/{id}`, its `responses` subcollection, and `needs_assessment_limits`. Existing catch-all Firestore rules deny direct browser reads/writes; no rule changes or indexes are required.
- Management uses the existing approved/active officer checks plus `bulletin.manage`. Survey/response listing requires an approved/active officer or administrator. No client role or owner ID is trusted.
- Public reads expose only the published questionnaire and availability, never responses, author IDs, or response counts. Drafts/archives are private.
- Responses accept only targeted departments, known questions, valid choices and bounded answers. Department is self-reported. Names, UIDs, email addresses and raw IP addresses are not stored in response documents; users should avoid personal details in text answers. Platform infrastructure can still log request metadata.
- Schedule checks, response creation and count updates occur in a Firestore transaction. A browser-generated submission ID is hashed as the document ID: retries cannot double count. Local storage preserves the ID in the same browser. Clearing storage or using another browser can submit again. This is not one verified response per student.
- A separate hashed network/minute counter allows up to 30 new submissions per minute per IP across surveys. A campus sharing an IP may need to retry after a minute. This is basic throttling, not complete bot protection. Functions use existing App Check enforcement settings; production abuse controls should be configured and verified before public launch.
- The rate limit document `expiresAt` is a Firestore timestamp. Configure a TTL policy on `needs_assessment_limits.expiresAt` in the approved target environment to clean up counters. TTL is optional for correctness; the minute key expires the rate window even before cleanup.
- Lists use cursor pagination (50 surveys/200 responses per request). Reports fetch all pages, then aggregate locally; very large surveys may need server-side aggregation later. Table previews display at most 100 rows; exports include all fetched rows. Concurrent new submissions may require a refresh.

## Deployment gate and staging

No Firebase, Supabase, Vercel settings, or remote resources were changed or deployed for this implementation. The local Firebase CLI could not authenticate to `ssu-usc-email-staging`; its database edition, billing, and deployment readiness remain unverified. Code uses the repository's existing Firestore Admin SDK API and has not been tested against that live database.

Before presenting a working hosted Preview, separately authorize and verify:

1. Firebase access to the isolated `ssu-usc-email-staging` project, its Firestore database/edition, Functions billing eligibility and an active test officer with a trusted role and `bulletin.manage`. Do not use production student records.
2. An isolated staging web Firebase configuration (the repository currently retains its existing production configuration; do not test the new service against production). Keep secrets out of frontend configuration.
3. Deploy ONLY the five Needs Assessment callable functions to staging after explicit approval; do not redeploy all existing election/email functions. They require no Supabase secrets. Function region is `asia-southeast1`.
4. Verify App Check configuration and optional TTL cleanup, then run the full workflow with synthetic staging data, including unauthorized access attempts and concurrent submissions.
5. Review exact changes and obtain approval before pushing/creating a PR or deploying. The user performs the final merge. Production Functions deployment requires separate explicit approval and should precede activating the frontend.

Deployment selection once authorized:

```sh
firebase deploy --project ssu-usc-email-staging --only functions:needsAssessmentManage,functions:needsAssessmentList,functions:needsAssessmentResponses,functions:needsAssessmentPublic,functions:needsAssessmentSubmit
```

## Local verification

- `npm test` includes survey validation, scheduling, reports/CSV, announcement URL safety, authorization checks, private drafts, publication immutability, transaction retry/count behavior and throttling.
- `node tests/browser/needs-assessment.cjs` runs real UI code with synthetic callable fixtures. It never connects to Firebase and deliberately substitutes authentication guards; it tests interface behavior, not live authentication or Firestore integration. Set `USC_REVIEW_OUTPUT` to choose screenshot/report output directory.
- The transaction unit tests use an in-memory serialized transaction double; they do not replace staging/emulator Firestore integration testing.
