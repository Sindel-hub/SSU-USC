import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeOfficerPermissions, permissionsForOfficerPosition } from '../shared/officer-permissions.js';
const require = createRequire(import.meta.url);
const { historyFixture } = require('./helpers/officer-history-fixture.cjs');
const { POSITIONS } = require('../server/officer-history.cjs');
const { DEPARTMENTS } = require('../functions/needs-assessment-model.js');
test('supported offices can be appointed, including draft-only Executive Secretary', async () => {
  const f = historyFixture();
  assert.deepEqual(Object.keys(POSITIONS), ['Executive Secretary', 'President', 'Treasurer', 'Public Information Officer', 'USC Representative']);
  await assert.rejects(f.assign('first', 'Secretary'), { code: 'invalid-argument' });
  await assert.rejects(f.assign('first', 'Treasurer', { permissions: ['dashboard.view', 'bulletin.manage'] }), { code: 'invalid-argument' });
  await assert.rejects(f.assign('first', 'USC Representative', { department: 'Made-up department' }), { code: 'invalid-argument' });
  const a = await f.assign(); assert.equal(a.authSyncPending, false);
  assert.equal(f.authUsers.get('first').customClaims.role, 'officer');
  assert.equal(f.records.get('users/first').officerPermissionSource, 'custom');
  assert.equal(f.records.get('school_accounts/990001').role, 'officer');
});
test('appointments require approved active students, trusted administrators and recent authentication', async () => {
  const f = historyFixture();
  await assert.rejects(f.h.officerAssignmentManage(f.req('first', { action: 'assign' })), { code: 'permission-denied' });
  const stale = f.req('admin', { action: 'sync', assignmentId: 'x' }); stale.auth.token.auth_time -= 1801;
  await assert.rejects(f.h.officerAssignmentManage(stale), { code: 'failed-precondition' });
  f.records.get('users/first').studentStanding = 'graduated';
  await assert.rejects(f.assign(), { code: 'failed-precondition' });
  assert.equal(f.reports().length, 0);
});
test('exact Student ID lookup rejects duplicates and does not reveal emails', async () => {
  const f = historyFixture();
  const person = await f.h.officerCandidateFind(f.req('admin', { studentId: '990001' }));
  assert.equal(person.uid, 'first'); assert.equal(person.email, undefined);
  f.records.set('users/duplicate', { studentId: '990001', role: 'student' });
  await assert.rejects(f.h.officerCandidateFind(f.req('admin', { studentId: '990001' })), { code: 'failed-precondition' });
});
test('concurrent appointments cannot fill the same office twice or overwrite existing assignments', async () => {
  const f = historyFixture();
  const results = await Promise.allSettled([f.assign('first'), f.assign('second')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(f.assign('first'), { code: 'already-exists' });
});
test('financial reports are immutable, server-attributed and retry-safe, with no view accomplishments', async () => {
  const f = historyFixture(); await f.assign();
  const request = () => f.req('first', { operationId: 'report-one', title: 'Treasurer report', content: 'Synthetic balances only.', officerName: 'Spoofed officer', position: 'President' });
  const first = await f.h.officerReportSubmit(request());
  assert.equal((await f.h.officerReportSubmit(request())).id, first.id);
  const record = await f.h.officerRecord(f.req('first', { recordId: first.id }));
  assert.equal(record.officerName, 'Synthetic first'); assert.equal(record.position, 'Treasurer');
  assert.equal(record.status, 'submitted'); assert.equal(record.snapshot.content, 'Synthetic balances only.');
  await f.h.officerTracklist(f.req('first', { assignmentId: 'assignment-first' }));
  await f.h.officerAssignments(f.req('first', {})); assert.equal(f.reports().length, 1);
  await assert.rejects(f.h.officerReportSubmit(f.req('first', { operationId: 'bad', title: 'x', content: 'x'.repeat(20001) })), { code: 'invalid-argument' });
});
test('turnover revokes previous writes, preserves attribution and grants only same-office historical access', async () => {
  const f = historyFixture(); await f.assign();
  const r = await f.h.officerReportSubmit(f.req('first', { operationId: 'one', title: 'Outgoing report', content: 'Preserve this.' }));
  await f.h.officerAssignmentManage(f.req('admin', { action: 'complete', assignmentId: 'assignment-first', reason: 'Approved turnover' }));
  assert.equal(f.records.get('school_accounts/990001').role, 'student');
  assert.equal(f.records.get('users/first').role, 'student'); assert.equal(f.authUsers.get('first').revoked, true);
  await assert.rejects(f.h.officerReportSubmit(f.req('first', { operationId: 'two', title: 'Not allowed', content: 'Ended term' }, 'officer')), { code: 'permission-denied' });
  await f.assign('second'); await f.assign('other', 'President');
  assert.equal((await f.h.officerRecord(f.req('second', { recordId: r.id }))).officerUid, 'first');
  assert.equal((await f.h.officerRecord(f.req('first', { recordId: r.id }))).officerUid, 'first');
  await assert.rejects(f.h.officerRecord(f.req('other', { recordId: r.id })), { code: 'permission-denied' });
  const own = await f.h.officerAssignments(f.req('second', { scope: 'office' }));
  assert.equal(own.items.length, 2); assert.ok(own.items.every(a => a.authorization === undefined));
  const detail = await f.h.officerAssignments(f.req('second', { assignmentId: 'assignment-first' }));
  assert.equal(detail.items[0].authorization, undefined);
});
test('assignment expiry blocks stale tokens without a scheduler and still requires explicit turnover', async () => {
  const f = historyFixture(); await f.assign(); f.advance(86400001);
  await assert.rejects(f.h.officerReportSubmit(f.req('first', { operationId: 'late', title: 'Late', content: 'Denied' })), { code: 'permission-denied' });
  await assert.rejects(f.assign('second'), { code: 'failed-precondition' });
  await f.h.officerAssignmentManage(f.req('admin', { action: 'complete', assignmentId: 'assignment-first', reason: 'Term expired' }));
  await f.assign('second');
});
test('an Auth synchronization outage does not restore ended profile access and is recoverable', async () => {
  const f = historyFixture(); await f.assign();
  const original = f.adminAuth.setCustomUserClaims; f.adminAuth.setCustomUserClaims = async () => { throw Error('Synthetic Auth outage'); };
  const r = await f.h.officerAssignmentManage(f.req('admin', { action: 'complete', assignmentId: 'assignment-first', reason: 'Turnover' }));
  assert.equal(r.authSyncPending, true); assert.equal(f.records.get('users/first').role, 'student');
  f.adminAuth.setCustomUserClaims = original;
  assert.equal((await f.h.officerAssignmentManage(f.req('admin', { action: 'sync', assignmentId: r.id }))).authSyncPending, false);
});
async function reviewedBulletin(f, key, input) {
  await f.assign('other', 'President');
  await f.h.announcementWorkflow(f.req('first', {action:'save',draftId:key,expectedVersion:0,input:{category:'Official Notice',audience:'All Students',...input}}));
  await f.h.announcementWorkflow(f.req('first', {action:'submit',draftId:key,expectedVersion:1}));
  await f.h.announcementWorkflow(f.req('other', {action:'ready',draftId:key,expectedVersion:1}));
  await f.h.announcementWorkflow(f.req('first', {action:'publish',draftId:key,expectedVersion:1}));
}
test('publishing a bulletin atomically records a sanitized snapshot and preserves attribution when a successor archives it', async () => {
  const f = historyFixture(); await f.assign('first', 'Public Information Officer');
  const action = { module: 'announcements', action: 'publish', operationId: 'bulletin-one', input: { title: 'Synthetic bulletin', content: 'A public notice', officerName: 'Spoof', extraPrivateData: 'must not copy' } };
  await reviewedBulletin(f,'bulletin-one',action.input); await f.h.announcementWorkflow(f.req('first',{action:'publish',draftId:'bulletin-one',expectedVersion:1}));
  assert.equal(f.reports().filter(r=>r.status==='published').length, 1); assert.equal(f.reports().find(r=>r.status==='published').snapshot.extraPrivateData, undefined);
  assert.equal(f.records.get('announcements/bulletin-one').createdByUid, 'first');
  await f.h.officerAssignmentManage(f.req('admin', { action: 'complete', assignmentId: 'assignment-first', reason: 'Turnover' }));
  await f.assign('second', 'Public Information Officer');
  await f.h.officerModuleAction(f.req('second', { module: 'announcements', action: 'archive', operationId: 'successor-archive', recordId: 'bulletin-one', sourceCollection: 'announcements' }));
  const { activityAttribution } = f.records.get('archived_announcements/bulletin-one').post;
  assert.equal(activityAttribution.published.name, 'Synthetic first');
  assert.equal(activityAttribution.removed.name, 'Synthetic second');
  assert.equal((await f.h.officerRecord(f.req('second', { recordId: f.reports()[0].id }))).officerName, 'Synthetic first');
});
test('announcement archive/delete/restore retain the original immutable snapshot', async () => {
  const f = historyFixture(); await f.assign('first', 'Public Information Officer');
  await reviewedBulletin(f,'post',{title:'Post',content:'Preserved text'});
  for (const [action, sourceCollection] of [['archive', 'announcements'], ['delete', 'archived_announcements'], ['restore', 'deleted_announcements']]) {
    await f.h.officerModuleAction(f.req('first', { module: 'announcements', action, operationId: 'op-' + action, recordId: 'post', sourceCollection }));
  }
  assert.ok(f.records.has('archived_announcements/post')); assert.equal(f.reports().length, 5);
  assert.equal(f.reports().find(r=>r.status==='published').snapshot.content, 'Preserved text');
});
test('events and programs publish with server attribution and preserve registrations when archived', async () => {
  const f = historyFixture(); await f.assign('first', 'Public Information Officer');
  for (const module of ['events', 'programs']) {
    const input = { title: 'Synthetic ' + module, description: 'Public activity', venue: 'SSU', eventDate: '2026-12-01', registrationMode: 'none' };
    await f.h.officerModuleAction(f.req('first', { module, action: 'publish', operationId: module, input }));
    await f.h.officerModuleAction(f.req('first', { module, action: 'update', operationId: 'update-' + module, recordId: module, input: { ...input, title: 'Updated ' + module } }));
    assert.equal(f.records.get(`${module}/${module}`).createdByUid, 'first');
    const versions = f.reports().filter(r => r.recordId === module && r.snapshot);
    assert.equal(versions[0].snapshot.title, 'Synthetic ' + module);
    assert.equal(versions[1].snapshot.title, 'Updated ' + module);
    f.records.set(`${module}/${module}/registrations/student`, { studentUid: 'student' });
    await f.h.officerModuleAction(f.req('first', { module, action: 'delete', operationId: 'archive-' + module, recordId: module }));
    assert.equal(f.records.get(`${module}/${module}`).status, 'Archived');
    assert.equal(f.records.get(`${module}/${module}`).eventDate, undefined);
    assert.equal(f.records.get(`${module}/${module}`).archivedEventDate, '2026-12-01');
    assert.ok(f.records.has(`${module}/${module}/registrations/student`));
  }
  assert.equal(f.reports().length, 6);
});
test('failed module validation creates neither a source record nor a misleading accomplishment', async () => {
  const f = historyFixture(); await f.assign('first', 'Public Information Officer');
  await assert.rejects(f.h.officerModuleAction(f.req('first', { module: 'events', action: 'publish', operationId: 'invalid', input: { title: 'Test', description: 'x', venue: 'SSU', eventDate: '2026-02-31', registrationMode: 'none' } })), { code: 'invalid-argument' });
  assert.equal(f.reports().length, 0); assert.equal(f.records.has('events/invalid'), false);
  await assert.rejects(f.h.officerModuleAction(f.req('first', { module: 'arbitrary_collection', action: 'publish', operationId: 'invalid', input: {} })), { code: 'invalid-argument' });
});
test('complaint review records metadata only and applies permissions against server state', async () => {
  const f = historyFixture(); await f.assign('first', 'President');
  f.records.set('complaints/private-case', { status: 'Submitted', content: 'Sensitive student details', studentUid: 'secret-student', classification: 'Student Level' });
  await f.h.officerModuleAction(f.req('first', { module: 'complaints', action: 'review', operationId: 'review', recordId: 'private-case', input: { status: 'Under Review', feedback: 'Private feedback' } }));
  assert.deepEqual(f.reports().map(row => row.action), ['Status updated', 'Responded']);
  const entry = f.reports()[0]; assert.equal(entry.snapshot, null);
  assert.ok(!JSON.stringify(entry).includes('Sensitive student details')); assert.ok(!JSON.stringify(entry).includes('Private feedback')); assert.ok(!JSON.stringify(entry).includes('secret-student'));
  assert.equal(f.records.get('complaints/private-case').thread[0].actorUid, 'first');
});
test('surveys record automatic creation/publication, and a successor cannot edit a predecessor draft', async () => {
  const f = historyFixture(); await f.assign('first', 'Public Information Officer');
  const input = { title: 'Needs survey', description: 'Synthetic priorities', departments: DEPARTMENTS, opensAt: f.now, closesAt: f.now + 3600000, questions: [{ label: 'Your priority?', type: 'text' }] };
  const draft = await f.h.needsAssessmentManage(f.req('first', { action: 'save', input }));
  await f.h.needsAssessmentManage(f.req('first', { action: 'publish', surveyId: draft.id }));
  assert.equal(f.reports().length, 2);
  const another = await f.h.needsAssessmentManage(f.req('first', { action: 'save', input }));
  await f.h.officerAssignmentManage(f.req('admin', { action: 'complete', assignmentId: 'assignment-first', reason: 'Turnover' }));
  await f.assign('second', 'Public Information Officer');
  await assert.rejects(f.h.needsAssessmentManage(f.req('second', { action: 'save', surveyId: another.id, input })), { code: 'permission-denied' });
  assert.equal(f.records.get('needs_assessment_surveys/' + another.id).createdBy, 'first');
  await assert.rejects(f.h.officerModuleAction(f.req('second', { module: 'events', action: 'update', operationId: 'forged-update', recordId: 'unknown', input: { title: 'Takeover', description: 'x', venue: 'SSU', eventDate: '2026-12-01', registrationMode: 'none' } })), { code: 'permission-denied' });
});
test('historical pages are private, paginated and do not disclose snapshots in tracklist metadata', async () => {
  const f = historyFixture(); await f.assign();
  for (let n = 0; n < 52; n++) await f.h.officerReportSubmit(f.req('first', { operationId: 'report-' + n, title: 'Report ' + n, content: 'Synthetic confidential balances' }));
  const page = await f.h.officerTracklist(f.req('first', { assignmentId: 'assignment-first' }));
  assert.equal(page.items.length, 50); assert.ok(page.next); assert.equal(page.items[0].snapshot, undefined);
  const tail = await f.h.officerTracklist(f.req('first', { assignmentId: 'assignment-first', after: page.next })); assert.equal(tail.items.length, 2);
  await assert.rejects(f.h.officerTracklist(f.req('other', { assignmentId: 'assignment-first' })), { code: 'permission-denied' });
});
test('the actual User Directory adapter preserves term permissions during status updates and rejects role takeover', async () => {
  const source = fs.readFileSync(new URL('../shared/security-client.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function browserAdminUpdateUser('), source.indexOf('\nfunction complaintClassificationFromRecord'));
  const updates = [];
  const old = { uid: 'officer', role: 'officer', officePosition: 'Treasurer', officerAssignmentId: 'term', officerPermissions: ['dashboard.view', 'organization.view', 'reports.generate'], officerPermissionSource: 'custom', accountStatus: 'approved', studentStanding: 'active' };
  const context = vm.createContext({ auth: { currentUser: { uid: 'admin', getIdTokenResult: async () => ({ claims: { role: 'admin' } }) } }, db: {}, doc: (...parts) => parts.at(-1), getDoc: async () => ({ exists: () => true, data: () => old }), normalizeStudentStanding: value => value || 'active', enrollmentStatusForStanding: () => 'enrolled', isActiveStudentStanding: value => value === 'active', normalizeOfficerPermissions, permissionsForOfficerPosition, serverTimestamp: () => 0, collection: () => 'audit', writeBatch: () => ({ update: (ref, data) => updates.push(data), set() {}, commit: async () => {} }), console });
  vm.runInContext(body, context);
  await context.browserAdminUpdateUser({ uid: 'officer', accountStatus: 'suspended', officerPermissions: [...old.officerPermissions].reverse() });
  assert.equal(updates[0].accountStatus, 'suspended'); assert.deepEqual([...updates[0].officerPermissions], old.officerPermissions); assert.equal(updates[0].officerPermissionSource, 'custom');
  await assert.rejects(context.browserAdminUpdateUser({ uid: 'officer', role: 'student' }), /Officer Management/);
  await assert.rejects(context.browserAdminUpdateUser({ uid: 'officer', officerPermissions: ['dashboard.view'] }), /Officer Management/);
});

test('activity feed retains authors across turnover, deletion and reuse of a Student ID', async () => {
  const f = historyFixture();
  await f.assign('first', 'Public Information Officer');
  const input = { title: 'Campus workshop', description: 'Public activity', venue: 'SSU', eventDate: '2026-12-01', registrationMode: 'none' };
  const create = { module: 'events', action: 'publish', operationId: 'workshop', input };
  await Promise.all([f.h.officerModuleAction(f.req('first', create)), f.h.officerModuleAction(f.req('first', create))]);
  await f.h.officerAssignmentManage(f.req('admin', { action: 'complete', assignmentId: 'assignment-first', reason: 'Turnover' }));
  f.records.delete('users/first');
  f.records.get('users/second').studentId = '990001';
  await f.assign('second', 'Public Information Officer', { administration: '2027–2028' });
  const edit = { module: 'events', action: 'update', recordId: 'workshop', operationId: 'workshop-edit', input: { ...input, title: 'Campus workshop updated' } };
  await f.h.officerModuleAction(f.req('second', edit));
  assert.equal((await f.h.officerModuleAction(f.req('second', { ...edit, operationId: 'no-change' }))).unchanged, true);
  assert.deepEqual(Object.values(f.records.get('events/workshop').activityAttribution).map(actor => actor.name), ['Synthetic first', 'Synthetic second']);
  f.records.delete('events/workshop');
  const own = await f.h.officerActivityList(f.req('second', {}));
  assert.deepEqual(own.items.map(row => row.officerUid), ['second']);
  const record = await f.h.officerActivityList(f.req('second', { recordModule: 'Events', recordId: 'workshop' }));
  assert.deepEqual(new Set(record.items.map(row => row.officerUid)), new Set(['first', 'second']));
  const admin = await f.h.officerActivityList(f.req('admin', { search: 'workshop', officer: 'first', module: 'Events & Programs', year: '2026–2027', from: '2026-11-21', to: '2026-11-21' }));
  assert.equal(admin.summary.modules.Events, 2);
  assert.equal(admin.items[0].recordTitle, 'Campus workshop');
  assert.equal(admin.items[0].snapshot, undefined);
  assert.equal(admin.items.length, 1);
});

test('complaint activity is private, retry-safe and records real changes for legacy officers', async () => {
  const f = historyFixture();
  Object.assign(f.records.get('users/first'), { role: 'officer', officePosition: 'President' });
  await f.assign('second', 'Public Information Officer');
  f.records.set('complaints/case', { status: 'Under Review', studentUid: 'confidential', subject: 'Private subject', thread: [{ classification: 'Student Level' }] });
  const data = { module: 'complaints', action: 'review', operationId: 'resolution', recordId: 'case', input: { status: 'Resolved', feedback: 'Private reply' } };
  await f.h.officerModuleAction(f.req('first', data, 'student'));
  await f.h.officerModuleAction(f.req('first', data, 'student'));
  assert.equal(f.records.get('complaints/case').thread.length, 2);
  const { items, summary } = await f.h.officerActivityList(f.req('first', {}, 'student'));
  assert.equal(summary.total, 2);
  assert.deepEqual(new Set(items.map(row => row.action)), new Set(['Resolved', 'Responded']));
  for (const item of items) {
    assert.equal(item.status, 'Resolved');
    assert.equal(item.administration, null);
    assert.doesNotMatch(JSON.stringify(item), /Private reply|Private subject|confidential|Student Level/);
  }
  await assert.rejects(f.h.officerActivityList(f.req('second', { recordModule: 'Complaints', recordId: 'case' })), { code: 'permission-denied' });
  assert.equal((await f.h.officerActivityList(f.req('second', { officer: 'first' }))).items.length, 0);
  await assert.rejects(f.h.officerModuleAction(f.req('second', data)), { code: 'permission-denied' });
});
