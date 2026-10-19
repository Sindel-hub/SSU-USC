# GitHub and Vercel delivery

## Expected existing integration

Use the existing Vercel project for `Sindel-hub/SSU-USC`. In that project's Git and build settings, verify:

- Connected GitHub repository: `Sindel-hub/SSU-USC`.
- Production branch: `main`.
- Root directory: `SSU-USC-main/uscmod`.
- Framework: Other (static HTML/CSS/JavaScript); no application build is required. Serve the website root, including its existing `vercel.json` redirect.
- Git deployment enabled for main and feature branches, with preview URLs/checks reported to GitHub pull requests.
- Existing environment bindings are preserved. Preview credentials should be appropriate for testing; the current browser configuration references hosted services, so a preview is not an isolated backend.

These are expected settings, not a claim that the remote settings have been verified. This environment could read Git but GitHub API requests returned Forbidden during configuration, and no Vercel management access was available. Confirm the integration in the existing project rather than importing a duplicate project.

## Change workflow

1. Create a dedicated branch; preserve unrelated work.
2. Make the change, review the diff, and run relevant checks from `SSU-USC-main/uscmod`:
   ```sh
   npm install --package-lock=false --no-audit --no-fund
   npm test
   ```
   There is no committed lockfile, so installation resolves manifest ranges. Also run focused tests for changed behavior and `git diff --check`.
3. Commit only the requested files, push the branch, and open/update a PR against main.
4. Record test outcomes and the Vercel preview URL from the PR checks/deployments. If no preview appears, investigate the Vercel Git integration, GitHub App repository access, deployment logs, and branch settings.
5. Wait for the user's approval and merge. Vercel should then deploy main through the existing integration.
6. Verify the production deployment is Ready for the merged commit before reporting the live site as updated.

The PR workflow runs the standard suite and JavaScript syntax validation separately. Existing source/test mismatches currently cause `npm test` to fail; report and resolve them in a separate scoped change, rather than skipping assertions. Repository owners should require PR review and passing checks in main's branch rules; these remote protections have not been configured by this change.

Frontend deployment does not deploy `supabase/functions`, database migrations, Firebase rules, or secret changes. Include explicit backend rollout requirements when a PR changes those components.
