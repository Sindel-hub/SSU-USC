import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../dashboard/js/election.js',import.meta.url),'utf8');
const officer=fs.readFileSync(new URL('../usc-admin/elections/js/elections.js',import.meta.url),'utf8');
test('creating multiple elections in one year generates independent IDs',()=>{const scope=vm.createContext({crypto:{randomUUID},Date});vm.runInContext(officer.slice(officer.indexOf('function newElectionId('),officer.indexOf('function populateScheduleEditor(')),scope);const ids=Array.from({length:20},()=>scope.newElectionId());assert.equal(new Set(ids).size,20);for(const id of ids)assert.match(id,/^[a-z0-9-]{3,80}$/)});
test('late application reads cannot restore previous election status after a switch',async()=>{
 let resolveB;const empty={exists:()=>false};let next={electionId:'B'};
 const scope=vm.createContext({student:{uid:'s'},auth:{currentUser:null},context:{electionId:'A'},application:{status:'Approved'},candidateDraft:{position:'President'},currentView:'registration',voterStatus:null,candidates:[],turnout:{},db:{},
 sessionProfile:()=>({}),sessionStorage:{setItem(){}},doc:(_db,...parts)=>parts.join('/'),callSecure:async()=>next,
 getDoc:async path=>path==='elections/B/applications/s'?new Promise(resolve=>{resolveB=resolve}):path==='elections/C/applications/s'?{id:'s',exists:()=>true,data:()=>({status:'Rejected',applicantUid:'s'})}:empty,
 stopWatchingCandidates(){},watchRegistration(){},watchElectionCandidates:async()=>{},});
 vm.runInContext(source.slice(source.indexOf('async function loadSecureState('),source.indexOf('let registrationSubscription =')),scope);
 const pending=scope.loadSecureState();await new Promise(resolve=>setImmediate(resolve));assert.equal(scope.application,null);assert.equal(scope.currentView,'landing');assert.equal(scope.candidateDraft,null);
 next={electionId:'C'};await scope.loadSecureState();resolveB({id:'s',exists:()=>true,data:()=>({status:'Approved'})});await pending;
 assert.equal(scope.context.electionId,'C');assert.equal(scope.application.electionId,'C');assert.equal(scope.application.status,'Rejected');
});

test('Create New never silently edits the currently active election',()=>{
 const elements=new Map();const node=id=>{if(!elements.has(id))elements.set(id,{value:'',showModal(){}});return elements.get(id)};
 const scope=vm.createContext({crypto:{randomUUID},Date,electionId:'old-election',context:{scheduleComplete:true,title:'Old election',scheduleVersion:3},els:{electionTitleInput:{value:''},saveElectionSettingsBtn:{}},scheduleInputs:{},$:node,msg(){},alert(){throw Error('Unexpected alert')},scheduleEditorMode:'edit',scheduleEditorOriginal:null,scheduleEditorVersion:null,scheduleFormDirty:false});
 vm.runInContext(officer.slice(officer.indexOf('function newElectionId('),officer.indexOf('function closeScheduleEditor(')),scope);
 scope.openScheduleEditor('create');assert.notEqual(node('electionIdInput').value,'old-election');assert.equal(scope.scheduleEditorVersion,null);assert.equal(node('electionIdInput').disabled,false);
 scope.openScheduleEditor('edit');assert.equal(node('electionIdInput').value,'old-election');assert.equal(scope.scheduleEditorVersion,3);assert.equal(node('electionIdInput').disabled,true);
});
