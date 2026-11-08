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
const source=fs.readFileSync(new URL('../dashboard/js/election.js',import.meta.url),'utf8');
test('application listener synchronizes removal and edits, ignoring retired election callbacks',()=>{
 const subscriptions=[];let renders=0;
 const scope=vm.createContext({db:{},context:{electionId:'A'},currentView:'landing',application:null,doc:(_db,...parts)=>parts.join('/'),onSnapshot:(path,next)=>{const sub={path,next,stopped:false};subscriptions.push(sub);return()=>sub.stopped=true},renderLanding:()=>renders++,renderApplicationStatus:()=>renders++,failClosed:()=>assert.fail('Unexpected listener error')});
 vm.runInContext(source.slice(source.indexOf('let registrationSubscription ='),source.indexOf('function timeline(')),scope);
 scope.watchRegistration('A','student');const snap=data=>({exists:()=>true,id:'student',data:()=>data});
 subscriptions[0].next(snap({fullName:'Corrected'}));assert.equal(scope.application.fullName,'Corrected');
 subscriptions[0].next(snap({removed:true}));assert.equal(scope.application,null);
 scope.context={electionId:'B'};scope.watchRegistration('B','student');
 subscriptions[1].next(snap({fullName:'B'}));subscriptions[0].next(snap({fullName:'Stale A'}));
 assert.equal(scope.application.fullName,'B');assert.equal(subscriptions[0].stopped,true);assert.equal(renders,3);
 scope.watchRegistration('','');assert.equal(subscriptions[1].stopped,true);
});
