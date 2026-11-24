# SSU-USC — Permanent Development, Preview, and Approval Workflow

From now on, whenever I request any modification, bug fix, feature, UI redesign, or improvement to my SSU-USC project, you must follow this workflow.

## 1. Protect the Production Website

- Never modify the production branch (`main`) directly.
- Never automatically merge or deploy changes to production.
- Preserve existing features, functionality, authentication, databases, and integrations.
- All modifications must initially take place in a separate development branch.
- Use a descriptive branch name based on the requested change.
- Do not modify production Firebase, Supabase, or Vercel configurations without my explicit authorization.

## 2. Implement the Requested Changes

Whenever I request a change:

1. Examine the relevant existing project files.
2. Implement only the requested changes and necessary supporting fixes.
3. Preserve unrelated features and working functionality.
4. Run the appropriate automated tests.
5. Fix any test failures caused by your changes.
6. Do not bypass, disable, or remove legitimate tests to obtain passing results.
7. Commit the completed changes to the development branch.

## 3. Automatically Create a Vercel Preview

After implementation and successful testing:

1. Push the development branch to my GitHub repository:
   `Sindel-hub/SSU-USC`
2. Open a pull request targeting `main`.
3. Allow the existing Vercel GitHub integration to generate a Preview deployment associated with that pull request.
4. Wait for the Vercel deployment to finish and verify that it succeeds.
5. Obtain the actual working Vercel Preview URL.
6. Provide that URL to me so I can inspect the modified website.

Do not invent or assume that a Preview deployment exists. Verify the real deployment and its URL.

If GitHub authentication, Vercel access, network restrictions, or environment configuration prevent Preview creation, stop and explain the specific blocker.

## 4. Preview Must Be Safe and Functional

The Vercel Preview must:

- Display the actual modified website, not screenshots or static mockups.
- Allow me to navigate and interact with the updated modules.
- Support desktop and mobile layouts.
- Include the requested changes and their supporting functionality.
- Use isolated staging Firebase and Supabase services when backend functionality needs testing.
- Never use production student records for testing.
- Never expose credentials, API secrets, or administrative keys.

If the changes require Supabase Edge Functions, Firebase rules, migrations, or other backend updates, ensure the required staging components are prepared and verified before presenting the Preview as fully functional.

Do not deploy backend changes to production without my explicit authorization.

## 5. GitHub Pull Request Review

Every modification must have a GitHub pull request.

The pull request must include:

- A clear title describing the change.
- A summary of all modifications.
- The files changed.
- Automated test results.
- Any identified risks or limitations.
- Screenshots if useful for UI changes.
- A link to the working Vercel Preview deployment.
- Any required backend deployment instructions.

Provide me with both:

**Vercel Preview URL:** [actual verified URL]

**GitHub Pull Request URL:** [actual PR URL]

I will use the Vercel Preview to inspect the website before deciding whether to approve the pull request.

## 6. Mandatory Approval Gate

I am the final decision-maker.

There are three possible outcomes:

**APPROVE**

If I approve the changes through the designated GitHub pull request review process, the pull request may be merged into `main` once all required checks pass.

Prefer using GitHub branch protection and required pull request reviews to enforce this rule.

If GitHub cannot technically enforce this approval requirement for the repository, do not substitute a conversational approval or assume permission to merge. Explain the limitation and leave merging as a manual action for me.

**REQUEST CHANGES**

If I request revisions:

- Keep working on the same development branch.
- Implement my requested corrections.
- Update the existing pull request.
- Generate an updated Vercel Preview.
- Provide the updated Preview URL.
- Require another review before merging.

**REJECT**

If I reject the changes:

- Do not merge them.
- Leave production unchanged.
- Preserve or close the pull request according to my instructions.
- Do not delete the branch or discard work without permission.

## 7. Production Deployment

After the pull request has been approved and merged into `main` through the authorized GitHub process:

1. Let Vercel deploy the merged production commit through the existing Git integration.
2. Verify the production deployment's success.
3. Confirm that the production website serves the approved changes.
4. Report any failures immediately.
5. Never describe a deployment as successful without verifying it.

If a backend production update is required, obtain my separate explicit approval before applying it. Coordinate the deployment order to prevent frontend/backend incompatibility.

## 8. Rollback and Safety

- Keep the previous working production deployment available for recovery where supported.
- Provide rollback instructions for any deployment that fails.
- Never delete or reset the repository to resolve an ordinary deployment problem.
- Do not overwrite unrelated work or existing uncommitted changes.
- Never expose GitHub tokens, Firebase credentials, or Supabase service-role keys.

## 9. Permanent Workflow Rule

Apply this workflow automatically to every future modification I request for this repository.

I should not need to repeat these instructions.

The workflow must always be:

**My Request → Codex Changes → Automated Tests → Development Branch → GitHub Pull Request → Vercel Preview → My Review → GitHub Approval → Merge to Main → Verified Production Deployment**

Never skip the Preview or approval stages.

Save these repository-specific working rules in `AGENTS.md` if appropriate, without deleting existing instructions. Treat `AGENTS.md` as project guidance, not as a replacement for GitHub branch protection, Vercel configuration, or other enforceable security controls.

---

## Latest user workflow update — November 2, 2026

The instructions below are the latest user-supplied workflow. They control wherever earlier guidance conflicts. In particular, **APPROVE** alone does not authorize production: only **APPROVE AND DEPLOY**, after review of the actual latest Vercel Preview and its exact commit, can authorize a merge/deployment. Required GitHub reviews, checks and protections must still pass. Production backend changes require separate explicit authorization.

# PERMANENT CODEX WORKFLOW — PREVIEW BEFORE APPROVAL AND DEPLOYMENT

From now on, whenever I ask you to modify, fix, redesign, update, or add features to my SSU-USC website, you must follow a strict **Preview → Review → Approval → Production Deployment** workflow.

## STEP 1 — Make the Requested Changes

1. Analyze my request and examine the relevant project files.
2. Implement the requested modifications on a separate development branch, never directly on `main`.
3. Preserve all existing features and functionality unless I explicitly request otherwise.
4. Run relevant automated tests and fix any issues caused by the changes.
5. Do not push changes directly to production.
6. Do not modify production Firebase, Supabase, or other backend services without explicit authorization.

## STEP 2 — Show Me the Changes First

After implementing my request:

1. Provide a clear summary of what was changed.
2. Show the differences between the original and modified code.
3. Explain which features were added, removed, or modified.
4. Identify any potential effects on existing functionality.
5. Push the changes to a separate GitHub development branch.
6. Create or update a GitHub Pull Request targeting `main`.
7. Generate a real Vercel Preview deployment connected to that development branch.
8. Provide the actual Vercel Preview URL.

**IMPORTANT:** The Preview must display the modified website itself, not just screenshots, descriptions, or code snippets.

I want to open the Preview website, navigate through the pages, click buttons, interact with modules, and visually inspect the changes before deciding whether to approve.

Use isolated staging Firebase and Supabase environments for changes requiring backend functionality. Never use production student data for testing.

## STEP 3 — Wait for My Decision

After showing me the changes and providing the Vercel Preview URL, stop and wait for my decision.

I have three options:

**APPROVE**

If I approve:
- Confirm that my approval refers to the latest reviewed Preview deployment and its exact commit.
- Merge the approved Pull Request into `main`, provided all required checks and GitHub protections pass.
- Allow Vercel to deploy the approved changes to the actual production website.
- Verify that the live website successfully reflects the approved changes.
- Provide the production URL and deployment confirmation.
- Request separate explicit authorization for any required production backend changes.

**REQUEST CHANGES**

If I am not satisfied:
- Do not merge or publish the changes.
- Make the corrections I request on the same development branch.
- Update the existing Pull Request.
- Generate a new Vercel Preview deployment.
- Let me review the updated website again.
- Wait for my approval.

**REJECT**

If I reject:
- Do not merge, deploy, or publish any changes.
- Keep the live production website unchanged.
- Preserve the draft unless I explicitly request its deletion.

## STEP 4 — Deploy Only Approved Changes

Production deployment is strictly prohibited until I explicitly approve the latest reviewed changes.

Do not interpret statements such as "looks good," "okay," or "continue" as production approval.

Only the explicit command **APPROVE AND DEPLOY**, given after I review the actual Vercel Preview, authorizes you to initiate the production merge and deployment.

If the code changes after my approval, require a new Preview and another approval.

## STEP 5 — Verify Production

After an authorized deployment:

1. Confirm that the GitHub Pull Request was merged successfully.
2. Confirm that Vercel deployed the intended commit to production.
3. Check the production website for deployment errors.
4. Report the final deployment status and URL.
5. If deployment fails, report the issue and provide recovery options without making unauthorized production changes.

## PERMANENT RULES

- Never deploy automatically after completing a modification.
- Never skip the Preview stage.
- Never treat a passing test suite as my approval.
- Never deploy an unreviewed change.
- Never merge directly into `main` before approval.
- Never invent a Preview URL or claim a deployment succeeded without verification.
- If GitHub, Vercel, or staging access is unavailable, stop and explain what needs to be configured.
- Preserve unrelated work and existing uncommitted changes.
- Keep this workflow active for all future requests in this project.
- Record these instructions in the repository's `AGENTS.md`, preserving any existing instructions, so future Codex tasks follow the same process.

## REQUIRED WORKFLOW

**I request changes → Codex modifies the website → Codex tests the changes → Codex shows me what changed → Vercel Preview website → I test and review → I say APPROVE AND DEPLOY → GitHub merges to main → Vercel updates the live website.**

My production website must remain unchanged until I have personally reviewed and explicitly approved the changes.

## Latest override — pull requests are merged manually by the user

The user reserves the final GitHub pull-request merge action for themselves. This overrides any earlier instruction authorizing Codex to merge after approval or after `APPROVE AND DEPLOY`.

- Prepare, test, commit and push development changes; create/update the PR and verified Preview as authorized.
- After review, leave the PR for the user to merge manually in GitHub.
- Never merge a PR, enable auto-merge, schedule a merge, or use a merge queue on the user's behalf. Approval does not grant that permission.
- Keep required checks and branch protections in place. Do not change repository or Vercel settings to circumvent this manual gate.
- The existing Vercel integration may deploy after the user manually merges. Verify and report that deployment when requested; do not initiate a separate production deployment without authorization.
- Required production backend changes still require separate explicit authorization and coordinated deployment order.

## Latest user override — review and explicit approval before any remote operation

For every development change, inspect the existing system, implement on a separate local development branch, and run relevant checks. Present (A) Changes Made, (B) Modified Files, (C) relevant before/after code or Git diff and UI previews when supported, and (D) actual testing results and limitations.

Then ask exactly: "Are you satisfied with these changes? Would you like me to revise anything, or do you approve these changes for pushing to GitHub?"

Stop and wait. The original change request, silence, and past approvals do not authorize a push. Without explicit approval for the reviewed changes, never push, create a pull request, publish, deploy, or change GitHub Actions, Vercel settings, or branch protections. This overrides older instructions above to automatically push and create a Vercel Preview. Local commits are allowed. If code changes after approval, repeat review and obtain approval again. After approval, verify the exact reviewed scope before submitting only that scope to the authorized branch. The existing manual-merge restriction remains in force: the user performs the final merge.

## Current mandatory workflow — development, Vercel Preview, and manual merge

This section governs all future system modifications, including bug fixes, features, UI improvements, and functionality updates. It supersedes conflicting earlier workflow instructions. For those tasks, the user has authorized pushing the development branch, opening or updating its pull request, and generating the Vercel Preview as part of the requested workflow. The review gate is after the Preview and pull request are ready.

### Isolate and validate changes

- Start each new task on a descriptively named Git branch based on the latest production branch. Make all changes on that development branch.
- Preserve existing functionality unless the user explicitly requests a change. Keep unrelated files out of the change.
- Check for errors, regressions, and compatibility issues. Run applicable build, lint, and test commands before deployment and verify the existing system remains functional.

### Create and verify the Preview

- Commit the changes and push only the development branch. Open a GitHub pull request targeting the production branch.
- Use the existing GitHub integration to generate the Vercel Preview. Verify that the deployment succeeded, corresponds to the latest commit, and serves the working Preview URL.
- Use designated staging or Preview services for testing. Protect production databases, Firebase and Supabase configuration, environment variables, authentication settings, and existing user records. Keep sensitive credentials out of commits and output.
- Deploy backend changes only to designated staging services when authorized. Report Preview configuration problems and keep production credentials out of staging.

### Hand off for review

- Report the changes, modified files, build and test results, development branch, latest commit ID, verified Vercel Preview URL, GitHub pull request URL, known issues or limitations, recommended functionality to test, and production deployment status.
- If a branch, pull request, or Preview cannot be created, explain the specific blocker and provide the manual steps needed. Report only links and outcomes that have been verified.
- Once the Preview and pull request are ready, stop for user review. Apply requested revisions on the same branch, update the same pull request, and verify and share the updated Preview URL.

### Reserve production for the user's manual merge

- The user personally merges the pull request in GitHub. Conversational approval never authorizes Codex to merge, schedule a merge, use a merge queue, or enable auto-merge.
- Never push directly to the production branch, deploy directly to Vercel Production, run `vercel --prod`, or promote a Preview to Production.
- Keep required approvals, checks, and branch protections in effect. Preserve the development branch through the user's review.
- Production deployment may proceed through the existing integration after the user's manual GitHub merge. Any production backend change requires separate explicit authorization.
