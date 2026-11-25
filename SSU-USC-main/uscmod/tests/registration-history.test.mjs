import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const store=fs.readFileSync(new URL('../shared/registration-history-store.js',import.meta.url),'utf8');
const status=new Function(store.slice(store.indexOf('export function historyElectionStatus'),store.indexOf('export async function manageCandidateRegistration')).replace('export ','')+';return historyElectionStatus;')();
test('history status survives deleted schedules and understands Firestore timestamps',()=>{
 assert.equal(status({scheduleDeleted:true,archived:true,finalized:true}),'Schedule Deleted');
 assert.equal(status({archived:true}),'Archived');assert.equal(status({finalized:true}),'Completed');
 assert.equal(status({votingEnd:{toMillis:()=>100}},200),'Completed');
 assert.equal(status({registrationStart:300},200),'Upcoming');assert.equal(status({registrationStart:100},200),'Ongoing');
});
