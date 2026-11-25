# Officer administration, historical records and tracklist

## Scope and appointment

This change implements the uploaded position-based history and Officer Tracklist requirements. It builds on commit `7fbcc0d` (PR #80's hosted Vercel backend). That backend's failed Preview and missing staging configuration must be resolved before this dependent change can have a functional hosted Preview. No remote setting, production record, billing plan, deployment, push or pull request was changed for this implementation.

The responsible individual/office is **Pending USC and appropriate university office approval**. The university must designate the administrator and authorized technical maintenance contact; software cannot appoint them. The initial assignment workflow supports President, Treasurer, Public Information Officer and USC Representative. Existing legacy positions and unrelated features are preserved, not silently reassigned.

The System Administrator manages authorized accounts, approved role assignments, access, configuration, operational monitoring, preservation, incident records and reviewed updates. The designated technical maintainer handles hosting, troubleshooting, backup/recovery and tested updates under university authorization. Neither role independently determines USC policy, certifies official student eligibility, approves financial transactions or modifies Registrar records. Official verification and appointment decisions remain with the relevant university office and USC.

## Responsibilities and module permissions

| Position | Initial permitted operations |
|---|---|
| President | Dashboard/organization, complaint review/classification/feedback/status/reports, bulletin and surveys, events, external programs, officer reports |
| Treasurer | Dashboard/organization, officer reports; the new immutable financial-report submission workflow |
| Public Information Officer | Dashboard/organization, bulletin and surveys, events and external programs |
| USC Representative | Dashboard/organization and complaint review for the represented SSU department assignment |

The administrator may reduce the checked permissions when appointing an officer. The server rejects permissions outside that position's initial scope, unknown positions and invalid departments. These presets are implementation defaults for review, not a declaration of university policy. Existing custom and legacy presets remain available to existing accounts. Complaint access keeps the existing module's authorization model; assignment department scopes historical office succession, **not** complaint case jurisdiction.

Financial reports are preserved text submissions, not accounting ledgers, uploaded spreadsheets, payment authorizations or certified audits. The Treasurer can submit a new report for corrections; existing submissions cannot be edited. No financial approval workflow is implied. Current activity coverage is surveys, bulletin lifecycle actions, event/program creation/updates/archiving, complaint review/feedback and financial-report submissions. Login, page views, report downloads, participant views, organization chart edits, Facebook delivery and off-system work are not counted as accomplishments.

## Administrator operating procedure

1. Verify the approved appointment and the student's existing authorized account. Use **User Directory** / **Student Records** for provisioning and annual academic updates; never recycle an outgoing officer's identity or password.
2. Open **Officer Management** from the administrator sidebar. Find the exact Student ID and check the displayed name. Missing/duplicate IDs require reconciliation first. New assignments require an approved, active, non-removed account and recent administrator authentication.
3. Select one of the four positions, administration period, a term start date and approved appointment reference. Representatives select a recognized SSU department. Review the permission checklist and confirm authorization.
4. Create the assignment. The server stores immutable identity/term attribution, reserves the office slot, links the profile and synchronizes Auth claims without replacing unrelated custom claims. There is one active assignment per student, and one office holder per position (per department for Representatives). Future appointments and overlapping active assignments are rejected. Term dates may span at most four years.
5. Resolve any **authentication synchronization pending** warning using the retry control. Auth and Firestore are not one transaction. The profile remains the access boundary during failures; no password/email or student identity is changed. Ask the officer to sign out and sign in again after successful synchronization.
6. Use **View tracklist** to inspect the saved officer, position, administration, module, action, status, related record and timestamp. Load further pages explicitly; the interface does not claim a partial page is a complete global analytics result. Appointment/turnover actions are recorded on the assignment itself; they are not credited as officer accomplishments.
7. For turnover, complete the outgoing term with an authorized reference/reason before assigning the successor. Completion changes the profile back to student access, revokes tokens through Auth synchronization and preserves all assignment/activity/report records. New assignments use a calculated expected anniversary and remain active until explicit turnover. Existing fixed-cutoff assignments still expire until an administrator explicitly adopts the expected-end policy; the office slot remains reserved until completion. The actual completion time and reason are recorded separately. See [Expected and actual term review](officer-term-policy-review.md).
8. Assign the incoming student a new assignment. **My office's terms** permits reference access to predecessor records in the same position and department. The successor cannot change a predecessor's survey, announcement, event, program, financial report, attribution or tracklist entry. A new contribution belongs to the incoming officer's own assignment.
9. Officer contributions are available through **Officer Tracklist** in the officer dashboard. The student dashboard does not include an officer contributions module. Graduated, suspended, removed or inactive users remain subject to existing access restrictions; preservation does not grant permanent portal access. Authorized administrators retain access to preserved records.

User Directory continues to manage account status and academic access controls. Term-managed role/position/permission fields cannot be changed through the old browser editor; use completion and a new reviewed assignment to correct an appointment. An account suspension does not delete its history. Appointment references are visible to administrators only; a tracklist's metadata omits document snapshots until a separately authorized record request.

## Preservation and automatic recording

All officer assignment, history, receipt and office-slot collections use the existing default-deny browser rules and are accessible only through authorized hosted endpoints. Historical record snapshots are append-only in the API; there are no update/delete endpoints. Attribution is copied from the trusted assignment at action time, so later profile name/position changes cannot rewrite credit. No previous accomplishments or missing terms are fabricated or retroactively assigned.

Each supported mutation checks the current profile and assignment inside its Firestore transaction. The source record and historical entry commit together. Rejected or failed mutations do not produce accomplishment entries. Read-only page visits do not create entries. Receipt IDs make a retry of the same operation idempotent; the UI disables a submitting button. A deliberate new submission is a new record, including a new financial-report correction. Existing legacy officers keep their old workflow until explicitly assigned a tracked term; their past actions are not reconstructed.

Survey draft changes preserve a new version; published questionnaires retain their existing immutable-question behavior. Event/program updates preserve previous content snapshots and original authorship. Removing a term-managed event/program archives it from live views and preserves registrations. Bulletin archiving, deletion and restoration preserve the creation snapshot even if the live copy is removed. Incoming officers use the history viewer to reference prior work rather than adopting it as their own. Legacy deletion behavior remains unchanged for unmigrated records/accounts.

Complaint review/feedback entries contain metadata and the opaque related case ID only. Student identity, complaint text, classification, attachments and feedback are not duplicated into history. Existing complaint permissions still determine access to the underlying case; a tracklist does not grant access. Term-managed cases are retained rather than deleted through the old browser delete action.

## Security and data model

- `officer_assignments/{id}`: trusted UID/name, position, department, administration, numeric term boundaries validated server-side, allowed permissions, approved appointment reference, appointment/completion actors and times, status and Auth sync marker.
- `officer_office_slots/{hash}`: private pointer for transactional single-holder enforcement.
- `officer_records/{id}`: immutable attribution, assignment, module/action/status, related record ID, server timestamp in milliseconds and optional bounded snapshot. It excludes private complaint content.
- `officer_operation_receipts/{uid_operationId}` and `officer_report_receipts/{uid_operationId}`: private deduplication results. Do not clear them casually: doing so changes retry behavior.
- The existing public announcement/event/program records gain `officerAssignmentId`; archived events/programs retain a tombstone. Public feeds omit archived items. Archiving moves `eventDate` to `archivedEventDate` on the retained tombstone, so existing ordered/limited live queries cannot be filled by archived rows. Registrations remain in place. Assignment references are opaque and do not make private assignment collections public.

The proposed rules add active-term checks for officer access, prevent tracked officers from bypassing the API for supported mutations, and keep server-owned assignment fields out of direct browser edits. New private collections inherit default deny. Existing public read policies and unrelated rules are preserved. No rule/index deployment was performed.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for term-based access revocation, private historical records and server-mediated officer mutations. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

## Verification and staging gate

Automated service tests use in-memory Auth/Firestore doubles. Browser checks exercise the actual hosted client, HTTP endpoint, administrator assignment UI, financial submission, turnover, predecessor reference, former-officer history and automatic bulletin activity with synthetic records. They do not prove live Firebase IAM, production token behavior or deployed Security Rules.

The Firebase database-edition lookup failed because the workspace is not authenticated to staging. The Firestore emulator attempt failed downloading its JAR with HTTP 403 (`Domain forbidden`); therefore rules syntax and emulator behavior remain **unverified** here. No bypass or production deployment was attempted. The rules integration test is prepared for an environment with the emulator:

```powershell
npm.cmd run test:officer-history
npm.cmd run test:officer-history-rules
```

Before a functional Preview, obtain approval for the reviewed code, prepare PR #80's isolated staging environment, validate the rules in the emulator, review/deploy only the approved staging rules and assignment index, and test real role-token refresh, appointment, delayed turnover, legacy expiry/adoption, Auth outage/retry, predecessor privacy and all supported module workflows. Verify the actual Preview URL and commit before release approval. No Firebase plan upgrade or laptop process is required for the hosted implementation; service quotas still apply. Production rules/configuration require separate explicit authorization, and the user retains the final merge action.

## Maintenance, incidents and handover

Maintain an approved register of the responsible administrator, university contact, technical maintainer, permitted access scope and succession arrangements. Keep private keys and account recovery methods in institution-approved secret storage, not in this register or repository. Review access at term turnover and when enrollment/appointment status changes.

For a fault, record the time, module, affected operation and non-sensitive request/error reference. Suspend affected access when authorized, preserve audit/assignment/history evidence, notify the designated university contact, and reproduce the issue in staging with synthetic records. Record the diagnosis, approved change, validation and recovery outcome. Do not include activation tokens, passwords, complaint narratives or private student data in troubleshooting records.

Test updates in staging, present the exact diff/results for approval, and keep the last known working deployment available. Reverting code does not undo appointments, restore roles, delete reports or reverse student record changes. If turnover is wrong, reconcile the authorized assignment and access state explicitly; never rewrite old officer attribution to hide a mistake. Establish university-approved retention, backup, exceptional correction and disposal procedures before broad use; this feature does not permanently delete history or silently apply a retention policy.
