# Officer policy conversion feedback and verification

## Problem and evidence

The user confirmed both dialogs, but their officer card retained the fixed cutoff and conversion button. The screenshot establishes that the displayed assignment had not changed; it does not expose the API rejection or prove which production backend version handled the request.

A confirmed UI defect explains why a failed save looks like a no-op: the shared action wrapper reports exceptions only in `historyStatus` at the top of the page. The conversion card has no nearby error or progress indicator. The earlier success path also trusted the mutation response and reset the assignment list to its first page without verifying the exact saved assignment.

The backend requires administrator authentication within the preceding 30 minutes. Tests reproduce a rejected conversion after that period, along with the original hidden-feedback behavior. This is a plausible live cause, not a confirmed diagnosis of the user's account. Production access/session/records were not available for authenticated inspection; public website fetches were also blocked by the environment proxy (HTTP 403). No production mutation was attempted.

## Changes

- Show progress, cancellation, server errors and success directly beside the conversion button, in an accessible status region. Focus and scroll failures into view.
- After the mutation, read the exact assignment by ID. Show success and remove the conversion button only after the server returns the adopted policy and March month. A 200 response without a saved change is reported as unconfirmed.
- Keep the currently loaded assignments and pagination. Updating a later-page card no longer resets the list to the first page.
- Distinguish a rejected save from a save whose verification read failed. The latter instructs the administrator to refresh before retrying, since the mutation may have committed.
- Make retries preserve the original policy-adoption time and authorization reason. The server returns the committed policy/month in its conversion acknowledgement.
- Report stale administrator authentication with officer-specific instructions to sign out, sign in again and retry. The 30-minute authentication requirement and all eligibility/office ownership guards remain enforced.

## Modified files

- `shared/officer-history.js`: inline status and exact-record save verification.
- `usc-admin/admin-dashboard/officer-management.html`: controller cache version.
- `server/officer-history.cjs`: retry-safe conversion acknowledgement and contextual authentication message.
- `server/authorization.cjs`: optional recovery message; existing callers retain their default wording and checks.
- `tests/officer-term-policy.test.mjs`: committed acknowledgement, retry audit retention, stale-auth denial without writes.
- `tests/browser/officer-management-only.cjs`: actual UI/HTTP success, stale authentication, no-op response, failed verification read, retry, button removal and page reload.
- This review document.

## Before and after

Before: confirmation → request → an error appears only above the visible card, or success is assumed from the mutation response and a first-page reload.

After: confirmation → inline saving message → mutation → exact-assignment read → verified saved card and removed conversion button. A rejection keeps the button and displays the reason beside it. Failed verification is labelled as uncertain rather than falsely reporting a successful conversion.

## Actual validation

- Officer history suite: **45 passed, 0 failed**.
- Hosted management, RBAC, announcement review, Needs Assessment and provisioning regression group: **36 passed, 0 failed**.
- JavaScript syntax and modified backend CJS checks passed.
- Management browser passed against actual pages/controllers and HTTP handlers with synthetic Auth/Firestore records. Verified inline stale-auth recovery and visible error position, 200 no-op detection, verification-read failure after commit, safe retry without audit overwrite, conversion button removal after verified save and after full reload, and existing promotion/completion/roster layouts at 1440/768/390 pixels. No browser errors.
- Production conversion remains unverified. The live account's precise rejection is unknown; this change does not claim to have modified or repaired its stored assignment. No rules changes or production deployment occurred.

## Review and release

Local commit only until the user approves pushing. The user performs the final merge. Verify the application and hosted backend together in an isolated staging Preview; no new function, schema migration or Firestore rules deployment is required by this feedback fix. No production account should be used as a test fixture.

The immediate existing-system recovery for a stale administrator sign-in is to sign out, sign in again and retry conversion. If conversion is rejected for another reason, the new inline message identifies that reason instead of leaving the administrator to infer success from the native confirmation dialogs.
