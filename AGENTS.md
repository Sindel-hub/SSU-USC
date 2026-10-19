# SSU-USC change and deployment workflow

- Work in the connected `Sindel-hub/SSU-USC` repository. The website root is `SSU-USC-main/uscmod`.
- Use the existing isolated checkout. Preserve unrelated tracked changes and untracked files; stage only files belonging to the request.
- Make each requested website modification on a dedicated branch, never directly on `main`.
- Review the diff, run relevant tests from the website root, and check `git diff --check`. Report actual results, including existing failures; never weaken tests to obtain a pass.
- Commit requested changes with a descriptive message, push the dedicated branch when access permits, and create or update a pull request targeting `main` (the intended production branch).
- The user approves and merges production changes. Do not merge, push directly to main, promote a deployment, or run a production deployment without explicit approval.
- Use the existing Vercel GitHub integration for branch previews and automatic deployment after merge. Do not create a second deployment pipeline or new Vercel project.
- Include the actual GitHub PR URL and Vercel preview URL when available. Check PR deployment/check records; do not guess a preview URL.
- Report local, committed, pushed, PR-created, merged, and deployed states separately. A successful push or merge does not prove deployment. Only claim the website is updated after verifying a successful production deployment for the merged commit.
- Report GitHub permissions, network restrictions, failed checks, and Vercel configuration blockers precisely. Never request credential values in chat.
- Vercel deploys the frontend only. Supabase Edge Functions, Firebase rules, migrations, and secrets have separate deployment requirements; do not claim those were deployed by a frontend merge.

See DEPLOYMENT.md for the expected integration and validation commands.
