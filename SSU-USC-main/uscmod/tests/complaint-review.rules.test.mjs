import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import { effectiveOfficerPermissions } from '../shared/officer-permissions.js';
let env;
const source = fs.readFileSync(new URL('../shared/security-client.js', import.meta.url), 'utf8');
before(async () => {
  env = await initializeTestEnvironment({projectId: 'demo-complaint-review', firestore: {rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')}});
});
after(async () => { await env?.cleanup(); });
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
  const bindings = {...firestore, db, effectiveOfficerPermissions, requireBrowserPermission: async () => ({user: {uid: 'officer'}, profile: officer, role: 'officer'})};
  const status = source.slice(source.indexOf('function isFirestorePermissionDenied'), source.indexOf('async function browserDeleteComplaintCase'));
  const permission = source.slice(source.indexOf('function browserHasOfficerPermission'), source.indexOf('async function requireBrowserPermission'));
  const reply = source.slice(source.indexOf('async function browserComplaintReply'), source.indexOf('async function browserSaveElectionSchedule'));
  const api = new Function(...Object.keys(bindings), `${permission}\n${status}\n${reply}\nreturn {browserComplaintReply, browserUpdateComplaintStatus};`)(...Object.values(bindings));
  return {db, ...api};
}
const review = {complaintId: 'case', previousStatus: 'Under Review', previousClassification: 'Student Level', classification: 'Student Level', status: 'Resolved'};
test('President can send feedback and resolve a classified complaint', async () => {
  const api = await seed();
  await api.browserComplaintReply({...review, feedback: 'The case has been addressed.'});
  const row = (await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data();
  assert.equal(row.status, 'Resolved');
  assert.equal(row.thread.length, 1);
});
test('President can resolve a complaint classified by an older thread-only client', async () => {
  const api = await seed({}, {classification: undefined, thread: [{by: 'Officer', kind: 'classification', classification: 'Student Level'}]});
  await api.browserUpdateComplaintStatus(review);
  assert.equal((await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data().status, 'Resolved');
});
test('explicit custom permissions allow feedback and status without granting classification changes', async () => {
  const api = await seed({officerPermissionSource: 'custom', officerPermissions: ['complaints.review', 'complaints.feedback', 'complaints.status']});
  await api.browserComplaintReply({...review, feedback: 'Resolved.'});
  await assertFails(firestore.updateDoc(firestore.doc(api.db, 'complaints/case'), {classification: 'Crisis Level', updatedAt: firestore.serverTimestamp()}));
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
  await api.browserComplaintReply({...review, feedback: 'First official feedback.'});
  assert.equal((await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data().thread.length, 1);
});

test('feedback permission alone cannot change case status', async () => {
  const api = await seed({officerPermissionSource: 'custom', officerPermissions: ['complaints.review', 'complaints.feedback']});
  await assert.rejects(api.browserComplaintReply({...review, feedback: 'Unauthorized resolution.'}));
  assert.equal((await firestore.getDoc(firestore.doc(api.db, 'complaints/case'))).data().status, 'Under Review');
});

test('compatibility does not allow malformed threads or bypass the thread limit', async () => {
  for (const thread of [null, 'invalid', Array.from({length: 200}, (_, n) => ({message: String(n)}))]) {
    const api = await seed({}, {thread});
    await assert.rejects(api.browserComplaintReply({...review, feedback: 'Must not overwrite history.'}));
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
