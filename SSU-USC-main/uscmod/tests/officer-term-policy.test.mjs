import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { historyFixture } = require('./helpers/officer-history-fixture.cjs');
const { expectedEnd, active } = require('../server/officer-term.cjs');
const ph = value => Date.parse(value + '+08:00');
const assignment = f => f.records.get('officer_assignments/assignment-first');
const manage = (f, data) => f.h.officerAssignmentManage(f.req('admin', { assignmentId: 'assignment-first', ...data }));
const report = (f, key) => f.h.officerReportSubmit(f.req('first', { operationId: key, title: 'Synthetic report', content: 'Synthetic only' }));

test('expected anniversary follows Philippine calendar, including leap day and year boundaries', () => {
 for (const [start, end] of [
  ['2026-03-15T09:30:00','2027-03-15T09:30:00'],
  ['2024-02-29T00:15:00','2025-02-28T00:15:00'],
  ['2026-01-01T00:15:00','2027-01-01T00:15:00']
 ]) assert.equal(expectedEnd(ph(start)), ph(end));
 assert.ok(Number.isNaN(expectedEnd(NaN)));
});
test('server derives expected end from the sole start date, ignoring stale induction and supplied cutoff', async () => {
 const f = historyFixture();
 await f.assign('first','Treasurer',{ startsAtMs: ph('2026-03-10T10:00:00'), inductionAtMs: ph('2026-03-15T10:00:00'), endsAtMs: 1, expectedEndsAtMs: 1, actualEndsAtMs: 1 });
 const a = assignment(f);
 assert.equal(a.expectedEndsAtMs, ph('2027-03-10T10:00:00'));
 assert.equal(a.endsAtMs, a.expectedEndsAtMs);
 assert.equal(a.actualEndsAtMs, null);
 assert.equal(a.startsAtMs, ph('2026-03-10T10:00:00'));
 assert.equal(Object.hasOwn(a, 'inductionAtMs'), false);
 assert.equal(a.termPolicy, 'until-turnover');
});
test('passing expected end retains authorized access until explicit completion, without freeing the office', async () => {
 const f = historyFixture(); await f.assign();
 const expected = assignment(f).expectedEndsAtMs;
 f.advance(expected - f.now + 1);
 await report(f,'after-anniversary');
 assert.equal((await f.h.officerDirectory(f.req('admin',{}))).items[0].term.status,'awaiting-turnover');
 await assert.rejects(f.assign('second'), {code:'failed-precondition'});
 const before = {...f.authUsers.get('first')};
 await manage(f,{action:'complete',reason:'Successors proclaimed; approved turnover'});
 const a = assignment(f);
 assert.equal(a.actualEndsAtMs,f.now); assert.equal(a.expectedEndsAtMs,expected);
 assert.equal(a.completionReason,'Successors proclaimed; approved turnover');
 assert.equal(f.records.get('users/first').role,'student');
 assert.equal(f.authUsers.get('first').password,before.password);
 await assert.rejects(report(f,'after-completion'), {code:'permission-denied'});
 assert.equal(f.reports().length,1);
 await f.assign('second');
});
test('expected-end policy does not bypass suspension, graduation, dropped standing or future start', async () => {
 for (const patch of [{isActive:false},{accountStatus:'suspended'},{studentStanding:'graduated'},{studentStanding:'dropped'}]) {
  const f=historyFixture(); await f.assign(); Object.assign(f.records.get('users/first'),patch);
  await assert.rejects(report(f,'blocked'),{code:'permission-denied'});
 }
 assert.equal(active({termPolicy:'until-turnover',status:'active',startsAtMs:200},100),false);
 assert.equal(active({termPolicy:'until-turnover',status:'active',startsAtMs:1,actualEndsAtMs:50},100),false);
});
test('legacy expiry remains enforced until explicitly authorized policy adoption, with an audit reference', async () => {
 const f=historyFixture();await f.assign(); const a=assignment(f);
 delete a.termPolicy; delete a.expectedEndsAtMs; delete a.inductionAtMs;
 a.endsAtMs=f.now-1;
 await assert.rejects(report(f,'legacy-expired'),{code:'permission-denied'});
 const inductionAtMs=a.startsAtMs;
 await manage(f,{action:'adopt-policy',inductionAtMs,reason:'Authorized CBL term policy'});
 assert.equal(assignment(f).policyAdoptedBy,'admin');
 assert.equal(assignment(f).policyReason,'Authorized CBL term policy');
 assert.equal(assignment(f).endsAtMs,a.endsAtMs); // Retain the original cutoff as history.
 await report(f,'adopted');
 const own=await f.h.officerAssignments(f.req('first',{}));
 assert.equal(own.items[0].policyReason,undefined);
});
test('policy adoption cannot revive completed, displaced, suspended or ineligible assignments', async () => {
 for (const change of [
  f=>manage(f,{action:'complete',reason:'Term ended'}),
  f=>{f.records.get('users/first').officerAssignmentId='different';},
  f=>{f.records.get('users/first').accountStatus='suspended';},
  f=>{f.records.get('users/first').studentStanding='dropped';},
  f=>{const key=[...f.records.keys()].find(k=>k.startsWith('officer_office_slots/'));f.records.get(key).assignmentId='different';}
 ]) {
  const f=historyFixture();await f.assign();assignment(f).termPolicy='fixed';await change(f);
  await assert.rejects(manage(f,{action:'adopt-policy',reason:'Do not restore'}),{code:'failed-precondition'});
 }
});
test('term changes require recent authorized admin and reject invalid dates or stale client policy', async () => {
 for (const patch of [{termPolicy:undefined},{startsAtMs:NaN},{startsAtMs:0},{startsAtMs:Date.now()+100*366*86400000}]) {
  const f=historyFixture();await assert.rejects(f.assign('first','Treasurer',patch));assert.equal(f.records.has('officer_assignments/assignment-first'),false);
 }
 const f=historyFixture();await f.assign();
 await assert.rejects(f.h.officerAssignmentManage(f.req('first',{action:'adopt-policy',assignmentId:'assignment-first',reason:'Unauthorized'})),{code:'permission-denied'});
 const req=f.req('admin',{action:'adopt-policy',assignmentId:'assignment-first',reason:'Stale'});req.auth.token.auth_time-=1801;
 await assert.rejects(f.h.officerAssignmentManage(req),{code:'failed-precondition'});
});
