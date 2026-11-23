# Announcement content review

Council decisions remain in-person decisions. This workflow checks the accuracy, wording, dates, attachments and confidentiality of the material that communicates those decisions.

## Workflow

Save draft → Send for review → Ready to publish → Publish reviewed post.

A reviewer can instead request revision, with a required note. The author edits and resubmits. Editing a ready draft increments its version and clears its previous review. In-review and published drafts cannot be edited. Authors cannot review their own posts. Publication reads the stored, reviewed version; it accepts no replacement content. Retrying publication does not create another announcement or another history event.

Drafts, images and review events live in the server-only `announcement_drafts` collection. Public readers continue using `announcements`, which receives a document only on publication. Images are embedded privately in the draft (up to 400,000 characters after browser resizing), and the published record links to `/api/announcement-image?id=...`. That endpoint returns image bytes only while the associated announcement is publicly published. This preserves HTTPS image delivery for the existing Facebook integration without exposing draft media. Published content uses the existing public feeds and paragraph formatting.

## Authority

- `bulletin.draft`: create/edit/submit own drafts.
- `bulletin.review`: review another author's submitted draft; request revision or mark ready.
- `bulletin.publish`: publish a ready draft.
- Existing `bulletin.manage` retains draft/publication/library management but does not grant content review.
- President position defaults include content review. New Executive Secretary appointments are draft-only. Existing Public Information Officer/legacy Bulletin managers retain publication authority.
- Administrator-controlled custom permissions remain explicit. A President with an existing custom grant set does not silently acquire the new review permission; the administrator must assign it if appropriate. Term-managed accounts must have the action in both the trusted profile and current assignment. Expired/inactive accounts cannot use the workflow.
- An administrator can configure designated reviewers through the existing permission controls. No live grants or account records are changed by this implementation.

Treasurer and other existing appointments remain supported. The pending broader officer-role matrix and complaint collaboration changes are not included in this branch.

## Compatibility and deployment order

The old tracked direct-publish API is rejected. Direct browser announcement creates/edits are rejected by the proposed Firestore rules. Archive/delete/restore remain available for already-published posts; restoration must copy the exact saved post and atomically remove its library copy. Forged archive content cannot be used to create a new publication.

Existing published announcements are not migrated or removed. New edits require a new reviewed draft rather than silently replacing reviewed content. There is no automatic email notification feature in this change. Facebook delivery is requested only after Bulletin publication and retains the existing retry/status handling.

Before staging verification, configure at least one author/publisher and a different reviewer. Run `npm test`, `npm run test:announcement-review-rules`, and the browser integration test with synthetic services. Deploy the compatible hosted API/page and the reviewed Firestore rules together during a coordinated release; stale browser direct-publish attempts will fail closed after the rules change. Review deployment separately and do not publish production rules without explicit authorization.

## Verification limits

Service and browser checks use synthetic accounts and the actual hosted handler. External Firebase authentication, public Facebook delivery, and deployed account grants are not tested by those fixtures. The Firestore emulator tests are included, but the environment's emulator download returned HTTP 403 (`Domain forbidden`); those tests and emulator rules compilation must pass in an environment with the official emulator available before broad rollout.
