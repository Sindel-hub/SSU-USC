import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { historyFixture } = require('./helpers/officer-history-fixture.cjs');
const { expectedEnd, active, awaitingTurnover } = require('../server/officer-term.cjs');
const ph = value => Date.parse(value + '+08:00');
const assignment = f => f.records.get('officer_assignments/assignment-first');
const manage = (f, data) => f.h.officerAssignmentManage(f.req('admin', { assignmentId: 'assignment-first', ...data }));
const report = (f, key) => f.h.officerReportSubmit(f.req('first', { operationId: key, title: 'Synthetic report', content: 'Synthetic only' }));

test('expected end follows March of the academic year ending year, with no invented day', () => {
 for (const year of ['2026-2027', '2026–2027', '2026 — 2027']) assert.equal(expectedEnd(year), '2027-03');
 assert.equal(expectedEnd('2027-2028'), '2028-03');
 for (const value of ['2026-2028', 'Synthetic 2026-2027', '2026', '', null]) assert.equal(expectedEnd(value), null);
 assert.equal(awaitingTurnover({expectedEndMonth:'2027-03'}, ph('2027-03-31T23:59:59')), false);
 assert.equal(awaitingTurnover({expectedEndMonth:'2027-03'}, ph('2027-04-01T00:00:00')), true);
});
test('server derives March from academic year, ignoring creation/start anniversary and supplied end dates', async () => {
 const f = historyFixture();
 await f.assign('first','Treasurer',{ startsAtMs: ph('2026-03-10T10:00:00'), inductionAtMs: ph('2026-03-15T10:00:00'), endsAtMs: 1, expectedEndsAtMs: 1, actualEndsAtMs: 1 });
 const a = assignment(f);
 assert.equal(a.expectedEndMonth, '2027-03');
 assert.equal(a.expectedEndsAtMs, null);
 assert.equal(a.endsAtMs, null);
 assert.equal(a.actualEndsAtMs, null);
 assert.equal(a.startsAtMs, ph('2026-03-10T10:00:00'));
 assert.equal(Object.hasOwn(a, 'inductionAtMs'), false);
 assert.equal(a.termPolicy, 'until-turnover');
});
test('passing expected March retains authorized access until explicit completion, without freeing the office', async () => {
 const f = historyFixture(); await f.assign();
 const expected = assignment(f).expectedEndMonth;
 f.advance(ph('2027-04-01T00:00:00') - f.now);
 await report(f,'after-anniversary');
 assert.equal((await f.h.officerDirectory(f.req('admin',{}))).items[0].term.status,'awaiting-turnover');
 await assert.rejects(f.assign('second'), {code:'failed-precondition'});
 const before = {...f.authUsers.get('first')};
 await manage(f,{action:'complete',reason:'Successors proclaimed; approved turnover'});
 const a = assignment(f);
 assert.equal(a.actualEndsAtMs,f.now); assert.equal(a.expectedEndMonth,expected);
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

test('late account creation and different term starts in the same academic year keep the same March end', async () => {
 for (const startsAtMs of [ph('2026-03-15T08:00:00'), ph('2026-11-20T08:00:00')]) {
  const f=historyFixture();await f.assign('first','Treasurer',{startsAtMs});assert.equal(assignment(f).expectedEndMonth,'2027-03');
 }
 const f=historyFixture();await assert.rejects(f.assign('first','Treasurer',{administration:'2026-2028'}),{code:'invalid-argument'});
 assert.equal(f.records.has('officer_assignments/assignment-first'),false);
});

test('existing active estimates display March without rewriting stored history or completed terms', async () => {
 const f=historyFixture();await f.assign();const a=assignment(f);
 delete a.expectedEndMonth;a.expectedEndsAtMs=ph('2027-11-25T09:00:00');
 const before=JSON.stringify(a);
 const current=await f.h.officerAssignments(f.req('admin',{}));
 assert.equal(current.items[0].expectedEndMonth,'2027-03');
 assert.equal(JSON.stringify(assignment(f)),before);
 assert.equal((await f.h.officerDirectory(f.req('admin',{}))).items[0].term.expectedEndMonth,'2027-03');
 await manage(f,{action:'complete',reason:'Synthetic turnover'});
 const completed=await f.h.officerAssignments(f.req('admin',{}));
 assert.equal(completed.items[0].expectedEndMonth,null);
 assert.equal(completed.items[0].expectedEndsAtMs,ph('2027-11-25T09:00:00'));
});

test('policy adoption acknowledges saved state and retries preserve the original audit reference', async () => {
 const f=historyFixture();await f.assign();const a=assignment(f);delete a.termPolicy;delete a.expectedEndMonth;
 const first=await manage(f,{action:'adopt-policy',reason:'First authorized conversion'});
 assert.equal(first.termPolicy,'until-turnover');assert.equal(first.expectedEndMonth,'2027-03');
 const before={...assignment(f)};f.advance(60000);
 const retry=await manage(f,{action:'adopt-policy',reason:'Retry after a lost response'});
 assert.equal(retry.termPolicy,'until-turnover');assert.equal(assignment(f).policyAdoptedAtMs,before.policyAdoptedAtMs);
 assert.equal(assignment(f).policyReason,'First authorized conversion');
});
test('stale administrator conversion fails with officer-specific recovery instructions and makes no writes', async () => {
 const f=historyFixture();await f.assign();delete assignment(f).termPolicy;
 const before=JSON.stringify(assignment(f));const req=f.req('admin',{action:'adopt-policy',assignmentId:'assignment-first',reason:'Synthetic approved'});req.auth.token.auth_time-=1801;
 await assert.rejects(f.h.officerAssignmentManage(req),error=>error.code==='failed-precondition'&&/Sign out and sign in again before changing officer assignments/.test(error.message));
 assert.equal(JSON.stringify(assignment(f)),before);
});
