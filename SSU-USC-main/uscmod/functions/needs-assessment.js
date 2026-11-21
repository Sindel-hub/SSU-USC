"use strict";
const { createHash } = require('node:crypto');
const { validateSurvey, validateResponse, surveyStatus } = require('./needs-assessment-model');
// All documents remain private under the existing default-deny Firestore rules.
// Public access is mediated by these narrowly scoped callable handlers only.
function createNeedsAssessmentHandlers({ db, requireActiveRole, requireOfficerPermission, HttpsError, history, clock = Date.now }) {
  const surveys = db.collection('needs_assessment_surveys');
  function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9]{20}$/.test(value)) throw new HttpsError('invalid-argument', 'Invalid survey link.'); return value; }
  async function survey(ref) { const snap = await ref.get(); if (!snap.exists) throw new HttpsError('not-found', 'Survey not found.'); return { id: snap.id, ...snap.data() }; }
  function validate(fn) { try { return fn(); } catch (e) { if (e.code === 'invalid-argument') throw new HttpsError(e.code, e.message); throw e; } }
  return {
    async needsAssessmentManage(request) {
      await requireOfficerPermission(request, 'bulletin.manage');
      const { action, surveyId, input } = request.data || {};
      if (action === 'save') {
        const content = validate(() => validateSurvey(input));
        const ref = surveyId ? surveys.doc(id(surveyId)) : surveys.doc();
        await db.runTransaction(async tx => {
          const assignment = history ? await history.context(tx, request, 'bulletin.manage') : null;
          const snap = await tx.get(ref);
          if (surveyId && !snap.exists) throw new HttpsError('not-found', 'Survey not found.');
          if (assignment && snap.exists && snap.data().officerAssignmentId !== assignment.assignmentId) throw new HttpsError('permission-denied', 'Previous officers’ surveys are read-only. Create your own survey.');
          if (snap.exists && snap.data().status !== 'draft') throw new HttpsError('failed-precondition', 'Only drafts can be edited. Duplicate a published survey to change its questions.');
          tx.set(ref, { ...content, status: 'draft', responseCount: 0, createdAt: snap.exists ? snap.data().createdAt : clock(), updatedAt: clock(), createdBy: snap.exists ? snap.data().createdBy : request.auth.uid, ...(assignment ? { officerAssignmentId: assignment.assignmentId } : {}) });
          if (history) history.append(tx, assignment, { module: 'Needs Assessment', action: snap.exists ? 'Survey draft updated' : 'Survey created', status: 'draft', recordId: ref.id, snapshot: content });
        });
        return { id: ref.id };
      }
      if (!['publish','close','archive'].includes(action)) throw new HttpsError('invalid-argument', 'Unknown action.');
      const ref = surveys.doc(id(surveyId));
      await db.runTransaction(async tx => {
        const assignment = history ? await history.context(tx, request, 'bulletin.manage') : null;
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'Survey not found.');
        const s = snap.data();
        if (assignment && s.officerAssignmentId !== assignment.assignmentId) throw new HttpsError('permission-denied', 'Previous officers’ surveys are read-only.');
        if (action === 'publish' && (s.status !== 'draft' || s.closesAt <= clock())) throw new HttpsError('failed-precondition', 'Only a draft with a future closing time can be published.');
        if (action === 'close' && s.status !== 'published') throw new HttpsError('failed-precondition', 'Only published surveys can be closed.');
        if (action === 'archive' && s.status === 'published' && surveyStatus(s, clock()) !== 'closed') throw new HttpsError('failed-precondition', 'Close the survey before archiving.');
        tx.update(ref, { status: action === 'publish' ? 'published' : action === 'close' ? 'closed' : 'archived', updatedAt: clock() });
        if (history) history.append(tx, assignment, { module: 'Needs Assessment', action: 'Survey ' + action, status: action === 'publish' ? 'published' : action === 'close' ? 'closed' : 'archived', recordId: ref.id });
      });
      return { id: ref.id };
    },
    async needsAssessmentList(request) {
      await requireActiveRole(request, ['officer','admin']);
      const after = request.data?.after;
      let q = surveys.orderBy('__name__').limit(51);
      if (after) q = q.startAfter(id(after));
      const docs = (await q.get()).docs;
      return { surveys: docs.slice(0,50).map(d => ({ id: d.id, ...d.data(), lifecycle: surveyStatus(d.data(), clock()) })), next: docs.length > 50 ? docs[49].id : null };
    },
    async needsAssessmentResponses(request) {
      await requireActiveRole(request, ['officer','admin']);
      const ref = surveys.doc(id(request.data?.surveyId));
      const s = await survey(ref);
      let q = ref.collection('responses').orderBy('__name__').limit(201);
      if (request.data?.after) {
        if (!/^[a-f0-9]{64}$/.test(request.data.after)) throw new HttpsError('invalid-argument', 'Invalid response cursor.');
        q = q.startAfter(request.data.after);
      }
      const docs = (await q.get()).docs;
      return { survey: s, responses: docs.slice(0,200).map(d => ({ id: d.id, ...d.data() })), next: docs.length > 200 ? docs[199].id : null };
    },
    async needsAssessmentPublic(request) {
      const s = await survey(surveys.doc(id(request.data?.surveyId)));
      if (s.status === 'draft' || s.status === 'archived') throw new HttpsError('not-found','Survey unavailable.');
      // Never return counts, author identifiers, or individual responses publicly.
      const { title, description, departments, questions, opensAt, closesAt } = s;
      return { id: s.id, title, description, departments, questions, opensAt, closesAt, lifecycle: surveyStatus(s, clock()) };
    },
    async needsAssessmentSubmit(request) {
      const { surveyId, submissionId } = request.data || {};
      if (typeof submissionId !== 'string' || !/^[a-f0-9-]{36}$/.test(submissionId)) throw new HttpsError('invalid-argument','Invalid submission identifier.');
      const ref = surveys.doc(id(surveyId));
      const receipt = createHash('sha256').update(submissionId).digest('hex');
      const responseRef = ref.collection('responses').doc(receipt);
      const minute = Math.floor(clock() / 60000);
      const rateId = createHash('sha256').update(`${minute}:${request.rawRequest?.ip || 'unknown'}`).digest('hex');
      const rateRef = db.collection('needs_assessment_limits').doc(rateId);
      await db.runTransaction(async tx => {
        const rate = await tx.get(rateRef);
        const [s, existing] = await Promise.all([tx.get(ref), tx.get(responseRef)]);
        if (!s.exists) throw new HttpsError('not-found','Survey not found.');
        if (existing.exists) return; // Safe retries after network loss: never double count.
        if ((rate.data()?.count || 0) >= 30) throw new HttpsError('resource-exhausted', 'Too many submissions from this network. Please wait a minute.');
        const response = validate(() => validateResponse(s.data(), request.data, clock()));
        tx.set(rateRef, { count: (rate.data()?.count || 0) + 1, expiresAt: new Date((minute + 2) * 60000) });
        tx.create(responseRef, { ...response, submittedAt: clock() });
        tx.update(ref, { responseCount: (s.data().responseCount || 0) + 1 });
      });
      return { submitted: true };
    }
  };
}
module.exports = { createNeedsAssessmentHandlers };
