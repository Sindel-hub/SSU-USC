"use strict";
const { isDeepStrictEqual } = require('node:util');
const { ServiceError } = require('./settings.cjs');
const { id, text, actorAttribution } = require('./officer-history.cjs');
function createAnnouncementWorkflow({ db, requireActiveRole, history, Timestamp, publicOrigin = 'https://example.invalid', clock = Date.now }) {
  const flags = p => ({ draft: p.includes('bulletin.draft') || p.includes('bulletin.manage'), review: p.includes('bulletin.review'), publish: p.includes('bulletin.publish') || p.includes('bulletin.manage') });
  async function capabilities(request) {
    const profile = await requireActiveRole(request, ['officer', 'admin'], { useOfficerProfile: true });
    const { effectiveOfficerPermissions } = await import('../shared/officer-permissions.js');
    const p = effectiveOfficerPermissions(profile, { legacyFullAccess: false });
    const caps = flags(p);
    if (profile.officerAssignmentId) {
      const a = (await db.doc(`officer_assignments/${id(profile.officerAssignmentId)}`).get()).data();
      const term = flags(a?.permissions || []);
      for (const key of Object.keys(caps)) caps[key] = caps[key] && term[key];
    }
    return { ...caps, approveOwn: profile.role === 'officer' && profile.officePosition === 'President' && caps.review && caps.publish };
  }
  function content(input = {}) {
    const result = { title: text(input.title, 'title', 160), content: text(input.content, 'content', 20000), category: text(input.category, 'category', 80), audience: text(input.audience, 'audience', 120), surveyId: input.surveyId ? id(input.surveyId) : '', facebookRequested: input.facebookRequested === true };
    // Draft images remain private within this server-only collection. Publication
    // copies the reviewed image into the existing public announcement document.
    result.imageUrl = text(input.imageUrl, 'image', 400000, true);
    result.imagePath = '';
    if (result.imageUrl && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(result.imageUrl)) throw new ServiceError('invalid-argument', 'Choose a JPEG, PNG, or WebP image.');
    result.content = input.content; // Preserve paragraph formatting.
    return result;
  }
  async function authority(tx, request) {
    const profile = (await tx.get(db.doc(`users/${request.auth.uid}`))).data();
    const fresh = { ...request, trustedProfile: profile };
    const caps = await capabilities(fresh);
    const assignment = history ? await history.context(tx, fresh, undefined, { includeLegacy: true }) : null;
    if (assignment?.assignmentId) {
      const term = flags(assignment.permissions || []);
      for (const key of Object.keys(term)) caps[key] = caps[key] && term[key];
      caps.approveOwn = caps.approveOwn && assignment.position === 'President' && caps.review && caps.publish;
    }
    return { caps, assignment };
  }
  return {
    async announcementPublishedImage(draftId) {
      const key = id(draftId);
      const [draft, post] = await Promise.all([db.doc(`announcement_drafts/${key}`).get(), db.doc(`announcements/${key}`).get()]);
      const image = draft.data()?.content?.imageUrl;
      if (!post.exists || post.data().reviewDraftId !== key || draft.data()?.status !== 'published' || !image) throw new ServiceError('not-found', 'Image not found.');
      return image;
    },
    async announcementDraftList(request) {
      const caps = await capabilities(request);
      if (!caps.draft && !caps.review && !caps.publish) throw new ServiceError('permission-denied', 'Announcement workflow access is not assigned to your office.');
      let q = db.collection('announcement_drafts');
      if (!caps.review && !caps.publish) q = q.where('authorUid', '==', request.auth.uid);
      q = q.orderBy('__name__').limit(51);
      if (request.data?.after) q = q.startAfter(id(request.data.after));
      const docs = (await q.get()).docs;
      return { capabilities: caps, items: docs.slice(0, 50).map(d => ({ id: d.id, ...d.data() })), next: docs.length > 50 ? docs[49].id : null };
    },
    async announcementWorkflow(request) {
      await capabilities(request);
      const { action, draftId, expectedVersion, input, note } = request.data || {};
      if (!['save', 'submit', 'ready', 'revise', 'publish'].includes(action)) throw new ServiceError('invalid-argument', 'Unknown announcement action.');
      const ref = db.doc(`announcement_drafts/${id(draftId)}`);
      let result;
      await db.runTransaction(async tx => {
        const { caps, assignment } = await authority(tx, request);
        const snap = await tx.get(ref), draft = snap.data();
        if (action === 'publish' && draft?.status === 'published' && caps.publish) { result = { id: ref.id, status: 'published', facebookRequested: draft.content.facebookRequested }; return; }
        if (action === 'save' && caps.draft && draft?.authorUid === request.auth.uid && draft.status === 'draft' &&
            [draft.version - 1, draft.version].includes(expectedVersion) && isDeepStrictEqual(content(input), draft.content)) {
          result = { id: ref.id, version: draft.version, status: draft.status, facebookRequested: draft.content.facebookRequested };
          return;
        }
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion !== (draft?.version || 0)) throw new ServiceError('aborted', 'This draft changed. Refresh and review the latest version.');
        const at = clock(), actor = request.auth.uid;
        let patch, event;
        if (action === 'save') {
          if (!caps.draft || (draft && draft.authorUid !== actor)) throw new ServiceError('permission-denied', 'Only the draft author can edit it.');
          if (draft && !['draft', 'needs-revision', 'ready'].includes(draft.status)) throw new ServiceError('failed-precondition', 'This draft cannot be edited while in review or after publication.');
          const payload = content(input);
          if (payload.surveyId) {
            const survey = await tx.get(db.doc(`needs_assessment_surveys/${payload.surveyId}`));
            if (!survey.exists || survey.data().status !== 'published') throw new ServiceError('failed-precondition', 'Attach a published survey.');
          }
          patch = { content: payload, status: 'draft', version: expectedVersion + 1, reviewedVersion: null, reviewedBy: '', approvalMode: null, reviewedAtMs: null, reviewNote: '', authorUid: actor, authorAssignmentId: assignment?.assignmentId || '', createdAtMs: draft?.createdAtMs || at };
          if (assignment) patch.activityAttribution = {
            ...draft?.activityAttribution,
            [draft ? 'updated' : 'created']: actorAttribution(assignment, at)
          };
          event = draft ? 'Updated' : 'Created';
        } else {
          if (!draft) throw new ServiceError('not-found', 'Draft not found.');
          if (action === 'submit') {
            if (!caps.draft || draft.authorUid !== actor) throw new ServiceError('permission-denied', 'Only the author can submit a draft.');
            if (!['draft', 'needs-revision'].includes(draft.status)) throw new ServiceError('failed-precondition', 'Save the draft before submitting for review.');
            patch = { status: 'in-review', reviewNote: '' }; event = 'Submitted for content review';
          } else if (action === 'ready' || action === 'revise') {
            const ownDraft = draft.authorUid === actor;
            const presidentApproval = ownDraft && action === 'ready' && caps.approveOwn;
            if (!caps.review || (ownDraft && !presidentApproval)) throw new ServiceError('permission-denied', 'A designated reviewer other than the author must review this post.');
            if (draft.status !== 'in-review') throw new ServiceError('failed-precondition', 'Only a submitted draft can be reviewed.');
            const reviewNote = text(note, 'review note', 2000, action === 'ready');
            patch = { status: action === 'ready' ? 'ready' : 'needs-revision', reviewedBy: actor, approvalMode: presidentApproval ? 'president-self' : null, reviewedVersion: action === 'ready' ? draft.version : null, reviewedAtMs: at, reviewNote };
            event = presidentApproval ? 'President approved own draft' : action === 'ready' ? 'Ready to publish' : 'Revision requested';
          } else {
            if (!caps.publish) throw new ServiceError('permission-denied', 'Publishing is not assigned to your office.');
            if (draft.status !== 'ready' || draft.reviewedVersion !== draft.version || !draft.reviewedBy || (draft.reviewedBy === draft.authorUid && draft.approvalMode !== 'president-self')) throw new ServiceError('failed-precondition', 'The current draft must be reviewed and marked Ready to publish.');
            const post = db.doc(`announcements/${ref.id}`), existing = await tx.get(post);
            if (existing.exists) throw new ServiceError('already-exists', 'This announcement ID already exists.');
            if (draft.content.surveyId) {
              const survey = await tx.get(db.doc(`needs_assessment_surveys/${draft.content.surveyId}`));
              if (!survey.exists || survey.data().status !== 'published') throw new ServiceError('failed-precondition', 'The attached survey is no longer published.');
            }
            tx.create(post, { ...draft.content, imageUrl: draft.content.imageUrl ? `${publicOrigin}/api/announcement-image?id=${encodeURIComponent(ref.id)}` : '', createdByUid: actor, createdByEmail: '', createdAt: Timestamp.fromMillis(at), createdAtMs: at, ...(assignment?.assignmentId ? { officerAssignmentId: assignment.assignmentId } : {}), activityAttribution: { ...draft.activityAttribution, ...(assignment ? { published: actorAttribution(assignment, at) } : {}) }, reviewDraftId: ref.id, reviewedVersion: draft.version, reviewedByUid: draft.reviewedBy });
            patch = { status: 'published', publishedBy: actor, publishedAtMs: at }; event = 'Published reviewed announcement';
          }
        }
        tx.set(ref, { ...(draft || {}), ...patch, updatedAtMs: at });
        tx.create(ref.collection('events').doc(), { action: event, actorUid: actor, version: patch.version || draft.version, atMs: at });
        if (history && ['save', 'publish'].includes(action)) history.append(tx, assignment, { module: 'Bulletin Board', action: event, status: patch.status, recordId: ref.id, recordTitle: (patch.content || draft.content).title, snapshot: action === 'publish' ? draft.content : null });
        result = { id: ref.id, version: patch.version || draft.version, status: patch.status, facebookRequested: (patch.content || draft.content).facebookRequested };
      });
      return result;
    }
  };
}
module.exports = { createAnnouncementWorkflow };
