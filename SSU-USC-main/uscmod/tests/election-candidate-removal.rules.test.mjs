// Emulator-only: synthetic documents and identities, never a production project.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(process.env.SSU_RULES_TEST_DEPENDENCIES || import.meta.url);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,collection,getDoc,setDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp}=require('firebase/firestore');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-ssu-candidate-removal',firestore:{rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearFirestore();});
async function seed(stage='ongoing'){
 const now=Date.now();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore(),batch=writeBatch(db);
  for(const [uid,permissions] of [['module',['elections.view']],['reviewer',['elections.review']],['other',[]]]){
   batch.set(doc(db,'users',uid),{role:'officer',accountStatus:'approved',isActive:true,studentStanding:'active',officePosition:'Secretary',officerPermissionSource:'custom',officerPermissions:permissions});
  }
  batch.set(doc(db,'elections','e'),{votingStart:Timestamp.fromMillis(stage==='scheduled'?now+3600000:now-3600000),votingEnd:Timestamp.fromMillis(stage==='completed'?now-1000:now+7200000)});
  for(const id of ['one','two'])batch.set(doc(db,'elections','e','candidates',id),{candidateId:id,fullName:id,position:'President',department:'Arts',approved:true});
  batch.set(doc(db,'elections','e','ballots','historical'),{selections:{President:'one'}});
  batch.set(doc(db,'elections','e','results','official'),{results:[{candidateId:'one',votes:7}]});
  await batch.commit();
 });
}
async function remove(uid,stage='ongoing',{extra={},audit=true,changeOther=false}={}){
 const db=env.authenticatedContext(uid,{role:'officer'}).firestore(),ref=doc(db,'elections','e','candidates','one');
 const before=(await getDoc(ref)).data(),auditRef=doc(collection(db,'audit_logs'));
 const changes={removed:true,updatedAt:serverTimestamp(),updatedByUid:uid,managementAuditId:auditRef.id,...extra};
 if(stage!=='scheduled')changes.resultIdentity=before;
 const batch=writeBatch(db);batch.update(ref,changes);
 if(audit)batch.set(auditRef,{actorUid:uid,electionId:'e',candidateId:'one',action:'CANDIDATE_REMOVE',target:ref.path,source:'browser-election-runtime',before,after:{...before,...changes},createdAt:serverTimestamp()});
 if(changeOther)batch.update(doc(db,'elections','e','candidates','two'),{fullName:'changed'});
 return batch.commit();
}
for(const stage of ['scheduled','ongoing','completed'])test(`module-access officer removes approved candidate during ${stage} election`,async()=>{
 await seed(stage);await assertSucceeds(remove('module',stage));
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();assert.equal((await getDoc(doc(db,'elections','e','candidates','one'))).data().removed,true);
  assert.equal((await getDoc(doc(db,'elections','e','candidates','two'))).data().fullName,'two');
  assert.equal((await getDoc(doc(db,'elections','e','results','official'))).data().results[0].votes,7);
  assert.equal((await getDoc(doc(db,'elections','e','ballots','historical'))).data().selections.President,'one');
 });
});
test('module access cannot edit the candidate while removing it',async()=>{await seed();await assertFails(remove('module','ongoing',{extra:{fullName:'unauthorized'}}));});
test('module access cannot omit the audit write',async()=>{await seed();await assertFails(remove('module','ongoing',{audit:false}));});
test('module access cannot forge an orphan removal audit',async()=>{
 await seed();const db=env.authenticatedContext('module',{role:'officer'}).firestore();
 await assertFails(setDoc(doc(collection(db,'audit_logs')),{actorUid:'module',electionId:'e',candidateId:'one',action:'CANDIDATE_REMOVE',target:'elections/e/candidates/one',source:'browser-election-runtime',createdAt:serverTimestamp()}));
});
test('unassigned officer cannot remove an approved candidate',async()=>{await seed();await assertFails(remove('other'));});
test('existing review-only officer retains removal permission',async()=>{await seed();await assertSucceeds(remove('reviewer'));});
test('physical deletion remains forbidden',async()=>{await seed();const db=env.authenticatedContext('module',{role:'officer'}).firestore();await assertFails(deleteDoc(doc(db,'elections','e','candidates','one')));});
test('attempt to change another candidate rejects the whole batch',async()=>{
 await seed();await assertFails(remove('module','ongoing',{changeOther:true}));
 await env.withSecurityRulesDisabled(async context=>{assert.equal((await getDoc(doc(context.firestore(),'elections','e','candidates','one'))).data().removed,undefined);});
});
