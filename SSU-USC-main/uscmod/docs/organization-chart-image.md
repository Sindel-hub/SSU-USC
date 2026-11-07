# Organizational chart image

Student, public landing-page and officer chart pages share a fixed image panel. The old role cards are replaced by a clearly marked placeholder until an officer publishes an image. Images use `object-fit: cover` to fill the canvas edge to edge without internal scrolling. The aspect ratio is preserved, so edges may be cropped when the image and panel proportions differ. Student/public readers have no outer inset around the image.

Active, approved officers and authorized administrators can choose a JPG/PNG/WebP (up to 5 MB), inspect a local preview, cancel, or publish. The browser re-encodes to WebP at a maximum dimension of 2048 pixels and a maximum data URL length of 900,000 characters. One bounded Firestore document stores the temporary chart; no Supabase/Storage deployment or upload ticket is required.

## Data and authorization

`organization_chart/current` contains only `imageData` and `updatedAt` (server timestamp). Public readers can fetch this one public image. Collection listing and deletion are denied. Students, anonymous users, inactive/unapproved/former officers, and forged administrator profiles cannot publish. The existing `isOfficerOrAdmin()` rule enforces account authority on the server. All active approved officers may publish this module's image; unrelated module permissions are unchanged.

## Required backend rollout

The new `match /organization_chart/{chartId}` block in `firestore.rules` must be enabled in the target backend before shared publishing works. It has been tested against an isolated **demo-ssu-org-chart** Firestore emulator with synthetic identities. No production rules or records were changed.

The Vercel Preview currently uses the repository's existing Firebase configuration. It can show the placeholder and let an authorized officer choose/cancel a local preview. **Persistent publishing will be rejected until the target Firebase rules include the new block.** This is a rollout dependency, not a missing officer role.

For an isolated staging environment, point the normal Firebase configuration at that environment and publish the new rule there before acceptance testing. No staging credentials or project were provisioned by this change. After review, production rule deployment requires the user's separate explicit approval. Preserve existing deployed rules: apply the new match block inside `/databases/{database}/documents` without replacing unrelated console fixes. No indexes or data migration are required. Merge/deploy the frontend only through the user's manual PR workflow.

To roll back the UI, revert this PR. The chart record is retained; no destructive cleanup is needed.

## Verification

- `npm test`: includes file validation/preparation and shared chart-page regression coverage.
- `npm run test:organization-chart-rules`: uses a demo project and Firestore emulator only.
- Chromium fixture uses actual pages and module with synthetic Firebase responses: selection/cancel, failed publish and retry, persistence to the student/public readers, full-image fitting, and fixed scroll-free containers at 320/390/768/1440px. No production records are used.
