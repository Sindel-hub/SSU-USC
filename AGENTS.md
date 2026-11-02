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
