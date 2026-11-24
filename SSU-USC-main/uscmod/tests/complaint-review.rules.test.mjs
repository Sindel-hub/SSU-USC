import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const require = createRequire(import.meta.url);
const { createAuthorization } = require('../server/authorization.cjs');
const { createOfficerHistory } = require('../server/officer-history.cjs');
const { createOfficerModuleHandlers } = require('../server/officer-modules.cjs');
const projectId = 'demo-complaint-review';
let env, app, server;
before(async () => {
  env = await initializeTestEnvironment({projectId, firestore: {rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')}});
  app = initializeApp({ projectId }, projectId);
  const db = getFirestore(app);
  const dependencies = { db, Timestamp, ...createAuthorization({ db }) };
  server = createOfficerModuleHandlers({ ...dependencies, history: createOfficerHistory(dependencies) });
});
after(async () => { await env?.cleanup(); if (app) await deleteApp(app); });
beforeEach(async () => { await env.clearFirestore(); });
async function seed(profile = {}, complaint = {}) {
  const officer = {role: 'officer', accountStatus: 'approved', isActive: true, officePosition: 'President', officerPermissions: ['dashboard.view', 'organization.view'], ...profile};
  await env.withSecurityRulesDisabled(async ctx => {
    await firestore.setDoc(firestore.doc(ctx.firestore(), 'users/officer'), officer);
    const record = {studentUid: 'student', status: 'Under Review', classification: 'Student Level', thread: [], ...complaint};
    for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
    await firestore.setDoc(firestore.doc(ctx.firestore(), 'complaints/case'), record);
  });
  const db = env.authenticatedContext('officer', {role: 'officer'}).firestore();
  let operation = 0;
  const review = input => server.officerModuleAction({
    auth: { uid: 'officer', token: { role: 'officer' } },
    data: { module: 'complaints', action: 'review', recordId: 'case', operationId: `review-${++operation}`, input }
  });
  return { db, review };
}
const review = {complaintId: 'case', previousStatus: 'Under Review', previousClassification: 'Student Level', classification: 'Student Level', status: 'Resolved'};
test('President can send feedback and resolve a classified complaint only through the hosted handler', async () => {
  const api = await seed();
  await assertFails(firestore.updateDoc(firestore.doc(api.db, 'complaints/case'), {status: 'Resolved', updatedAt: firestore.serverTimestamp()}));
  await api.review({...review, feedback: 'The case has been addressed.'});
  const history = await getFirestore(app).collection('officer_records').get();
  assert.deepEqual(new Set(history.docs.map(doc => doc.data().action)), new Set(['Resolved', 'Responded']));
  const row = (await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data();
  assert.equal(row.status, 'Resolved');
  assert.equal(row.thread.length, 1);
});
test('President can resolve a complaint classified by an older thread-only client', async () => {
  const api = await seed({}, {classification: undefined, thread: [{by: 'Officer', kind: 'classification', classification: 'Student Level'}]});
  await api.review(review);
  assert.equal((await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data().status, 'Resolved');
});
test('explicit custom permissions allow feedback and status without granting classification changes', async () => {
  const api = await seed({officerPermissionSource: 'custom', officerPermissions: ['complaints.review', 'complaints.feedback', 'complaints.status']});
  await api.review({...review, feedback: 'Resolved.'});
  await assert.rejects(api.review({...review, classification: 'Crisis Level'}), { code: 'permission-denied' });
});
test('student and suspended officer cannot send feedback or resolve cases', async () => {
  const api = await seed({accountStatus: 'suspended', isActive: false});
  const patch = {status: 'Resolved', updatedAt: firestore.serverTimestamp()};
  await assertFails(firestore.updateDoc(firestore.doc(api.db, 'complaints/case'), patch));
  const studentDb = env.authenticatedContext('student', {role: 'student'}).firestore();
  await assertFails(firestore.updateDoc(firestore.doc(studentDb, 'complaints/case'), patch));
});

test('older complaint without a thread can receive its first official feedback', async () => {
  const api = await seed({}, {thread: undefined});
  await api.review({...review, feedback: 'First official feedback.'});
  assert.equal((await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data().thread.length, 1);
});

test('feedback permission alone cannot change case status', async () => {
  const api = await seed({officerPermissionSource: 'custom', officerPermissions: ['complaints.review', 'complaints.feedback']});
  await assert.rejects(api.review({...review, feedback: 'Unauthorized resolution.'}));
  assert.equal((await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data().status, 'Under Review');
});

test('compatibility does not allow malformed threads or bypass the thread limit', async () => {
  for (const thread of [null, 'invalid', Array.from({length: 200}, (_, n) => ({message: String(n)}))]) {
    const api = await seed({}, {thread});
    await assert.rejects(api.review({...review, feedback: 'Must not overwrite history.'}));
  }
});

test('complaint owner, content, and classification requirements remain protected', async () => {
  const api = await seed();
  const ref = firestore.doc(api.db, 'complaints/case');
  await assertFails(firestore.updateDoc(ref, {studentUid: 'other', updatedAt: firestore.serverTimestamp()}));
  await assertFails(firestore.updateDoc(ref, {details: 'Rewritten', updatedAt: firestore.serverTimestamp()}));
  await seed({}, {classification: undefined});
  await assertFails(firestore.updateDoc(ref, {status: 'Resolved', updatedAt: firestore.serverTimestamp()}));
});
