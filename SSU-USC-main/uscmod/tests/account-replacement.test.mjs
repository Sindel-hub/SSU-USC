import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {historyFixture} = require('./helpers/officer-history-fixture.cjs');
const {createAccountReplacementHandlers} = require('../server/account-replacement.cjs');
function setup() {
  const f = historyFixture();
  f.records.get('users/first').accountStatus = 'suspended';
  f.records.get('users/first').isActive = false;
  f.records.set('complaints/history', {studentUid:'first',text:'Original work'});
  f.adminAuth.deleteUser = async uid => f.authUsers.delete(uid);
  const h = createAccountReplacementHandlers({db:f.db,adminAuth:f.adminAuth,...f.authorization,clock:()=>f.now});
  const data = {previousUid:'first',studentId:'990001',role:'student',fullName:'Replacement Person',college:'Test College',program:'Test Program',yearLevel:'1',studentStanding:'active',temporaryPassword:'SampleTestOnly123!'};
  return {f,h,data,run:patch=>h.accountReplace(f.req('admin',{...data,...patch}))};
}
test('replacement gets a new UID, retires old identity, revokes sessions and retains history',async()=>{
  const {f,run}=setup(); const result=await run(); const uid=result.credential.uid;
  assert.notEqual(uid,'first');
  assert.equal(f.records.get('student_id_claims/990001').uid,uid);
  assert.equal(f.records.get('users/'+uid).isActive,true);
  assert.equal(f.records.get('users/first').accountRemoved,true);
  assert.equal(f.authUsers.get('first').disabled,true);
  assert.equal(f.authUsers.get('first').revoked,true);
  assert.equal(f.records.get('complaints/history').studentUid,'first');
  await assert.rejects(f.authorization.requireActiveRole(f.req('first',{}),['student']),{code:'permission-denied'});
});
for (const role of ['student','officer']) test('active '+role+' cannot be replaced',async()=>{
  const {f,run}=setup();Object.assign(f.records.get('users/first'),{role,accountStatus:'approved',isActive:true});
  await assert.rejects(run(),{code:'failed-precondition'}); assert.equal(f.authUsers.size,3);
});
test('concurrent replacements produce exactly one owner and clean the losing Auth user',async()=>{
  const {f,run}=setup(); const results=await Promise.allSettled([run(),run()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.authUsers.size,4);
  const uid=f.records.get('student_id_claims/990001').uid;
  assert.equal(f.records.get('users/first').replacedByUid,uid);
});
for (const step of ['createUser','setCustomUserClaims','updateUser']) test(step+' failure preserves suspended account recovery',async()=>{
  const {f,run}=setup();f.adminAuth[step]=async()=>{throw Error('Synthetic failure');};
  await assert.rejects(run());assert.equal(f.records.get('users/first').accountRemoved,undefined);
  assert.equal(f.authUsers.get('first').disabled,false);assert.equal(f.authUsers.size,3);
  assert.equal(f.records.get('student_id_claims/990001').uid,'first');
});
test('transaction failure preserves ID and old account while deleting provisional Auth identity',async()=>{
  const {f,run}=setup();f.db.runTransaction=async()=>{throw Error('Synthetic transaction failure');};
  await assert.rejects(run());assert.equal(f.authUsers.size,3);
  assert.equal(f.records.get('users/first').accountRemoved,undefined);
  assert.equal(f.authUsers.get('first').disabled,false);
});
test('removed account with a legacy reservation can be replaced',async()=>{
  const {f,run}=setup();f.records.get('users/first').accountRemoved=true;
  const result=await run();assert.equal(result.ok,true);assert.notEqual(result.credential.uid,'first');
});
test('officer replacement uses position permissions and never inherits the old custom grants',async()=>{
  const {f,run}=setup();const result=await run({role:'officer',officePosition:'Treasurer'});
  const p=f.records.get('users/'+result.credential.uid);assert.equal(p.officerPermissionSource,'position-default');
  assert.equal(f.authUsers.get(result.credential.uid).customClaims.role,'officer');
});
test('changed directory ownership and duplicate name reservations reject replacement',async()=>{
  const {f,run}=setup();f.records.set('school_accounts/990001',{uid:'other'});
  await assert.rejects(run(),{code:'already-exists'});assert.equal(f.authUsers.size,3);
});
test('stale and non-admin sessions cannot start replacement',async()=>{
  const {f,h,data}=setup();await assert.rejects(h.accountReplace(f.req('other',data)),{code:'permission-denied'});
  const r=f.req('admin',data);r.auth.token.auth_time=1;await assert.rejects(h.accountReplace(r),{code:'failed-precondition'});
});
test('a lost transaction acknowledgement returns the committed replacement and revokes old sessions',async()=>{
  const {f,run}=setup();const original=f.db.runTransaction;
  f.db.runTransaction=async callback=>{await original(callback);throw Error('Lost acknowledgement');};
  const result=await run();assert.equal(result.created,true);
  assert.equal(f.authUsers.get('first').disabled,true);assert.equal(f.authUsers.size,4);
});
test('transient Auth retirement failure retries after commit, without creating a second replacement',async()=>{
  const {f,run}=setup();const original=f.adminAuth.updateUser;let failures=0;
  f.adminAuth.updateUser=async(uid,patch)=>{if(uid==='first'&&failures++===0)throw Error('Transient failure');return original(uid,patch);};
  const result=await run();assert.equal(result.retirementPending,false);
  assert.equal(f.authUsers.get('first').disabled,true);
  await assert.rejects(run(),{code:'already-exists'});assert.equal(f.authUsers.size,4);
});
test('reactivation during provisioning aborts replacement and leaves the original account recoverable',async()=>{
  const {f,run}=setup();const original=f.adminAuth.createUser;
  f.adminAuth.createUser=async user=>{const result=await original(user);Object.assign(f.records.get('users/first'),{isActive:true,accountStatus:'approved'});return result;};
  await assert.rejects(run(),{code:'failed-precondition'});
  assert.equal(f.records.get('users/first').isActive,true);assert.equal(f.authUsers.get('first').disabled,false);assert.equal(f.authUsers.size,3);
});
test('student and officer registration entry points route suspended IDs to the trusted handler',async()=>{
  const fs = await import('node:fs');
  let source = fs.readFileSync(new URL('../shared/browser-provisioning.js',import.meta.url),'utf8');
  source = source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
  source = source.replace('await import("./hosted-management-client.js")','await Promise.resolve({hostedManagementCall: replacementCall})');
  const snapshot = data => ({exists:()=>Boolean(data),data:()=>data});
  for (const role of ['student','officer']) {
    const calls=[];
    const bindings={auth:{currentUser:{uid:'admin',getIdTokenResult:async()=>({claims:{role:'admin'}})}},db:{},doc:(_,collection,id)=>({collection,id}),
      getDoc:async ref=>snapshot(ref.collection==='users' ? (ref.id==='admin'?{isActive:true,accountStatus:'approved'}:{studentId:'123',accountStatus:'suspended',isActive:false}) : ref.collection==='student_id_claims'?{uid:'old'}:null),
      replacementCall:async(action,data)=>{calls.push({action,data});return{ok:true,credential:{uid:'new'}};},
      normalizeStudentStanding:()=> 'active',enrollmentStatusForStanding:()=> 'enrolled',isActiveStudentStanding:()=>true,permissionsForOfficerPosition:()=>[]};
    const api=new Function(...Object.keys(bindings),source+';return {provisionStudentAccount,provisionOfficerAccount};')(...Object.values(bindings));
    const input={studentId:'123',fullName:'New Person',college:'College',program:'Program',yearLevel:'1',officePosition:'Secretary'};
    const result=await api[role==='student'?'provisionStudentAccount':'provisionOfficerAccount'](input);
    assert.equal(result.credential.uid,'new');assert.equal(calls[0].action,'accountReplace');
    assert.equal(calls[0].data.role,role);assert.equal(calls[0].data.previousUid,'old');
  }
});
test('a legacy removed account whose Auth user was deleted can still release its ID',async()=>{
  const {f,run}=setup();f.records.get('users/first').accountRemoved=true;f.authUsers.delete('first');
  const update=f.adminAuth.updateUser;
  f.adminAuth.updateUser=async(uid,patch)=>{if(uid==='first')throw Object.assign(Error('Missing'),{code:'auth/user-not-found'});return update(uid,patch);};
  assert.equal((await run()).created,true);
});
test('a different account name reservation cannot be overwritten',async()=>{
  const {createHash}=await import('node:crypto');const {f,run}=setup();
  const key=createHash('sha256').update('replacement person').digest('hex');
  f.records.set('student_name_claims/'+key,{uid:'other'});
  await assert.rejects(run(),{code:'already-exists'});assert.equal(f.records.get('student_name_claims/'+key).uid,'other');
});
test('persistent Auth cleanup outage reports committed state and a retry completes retirement',async()=>{
  const {f,run}=setup();const update=f.adminAuth.updateUser;
  f.adminAuth.updateUser=async(uid,patch)=>{if(uid==='first')throw Error('Auth outage');return update(uid,patch);};
  const result=await run();assert.equal(result.created,true);assert.equal(result.retirementPending,true);
  await assert.rejects(f.authorization.requireActiveRole(f.req('first',{}),['student']),{code:'permission-denied'});
  f.adminAuth.updateUser=update;
  await assert.rejects(run(),{code:'already-exists'});assert.equal(f.authUsers.get('first').disabled,true);assert.equal(f.authUsers.get('first').revoked,true);
});
