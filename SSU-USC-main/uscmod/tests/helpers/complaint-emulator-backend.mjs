import {createRequire} from 'node:module';import {randomUUID,randomBytes} from 'node:crypto';
import {createComplaintWorkflow,complaintFirestoreOperations} from '../../supabase/functions/_shared/complaint-workflow.mjs';import {effectiveOfficerPermissions} from '../../shared/officer-permissions.js';
const require=createRequire(process.env.SSU_RULES_TEST_DEPENDENCIES||import.meta.url),sdk=require('firebase/firestore');
export function complaintBackend(env,uid='officer',{verified=true}={}){
 const run=async(method,input)=>{let result;await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore(),get=async path=>{const snap=await sdk.getDoc(sdk.doc(db,path));return snap.exists()?{data:snap.data(),version:JSON.stringify(snap.data())}:null};
  const commit=async rawOperations=>{const operations=complaintFirestoreOperations(rawOperations);return sdk.runTransaction(db,async tx=>{const snapshots=await Promise.all(operations.map(o=>tx.get(sdk.doc(db,o.path))));operations.forEach((o,i)=>{const snap=snapshots[i];if((snap.exists()?JSON.stringify(snap.data()):null)!==o.version)throw Error('Concurrent workflow change')});operations.forEach(o=>tx.set(sdk.doc(db,o.path),o.data,{merge:!o.replace}))})};
  const service=createComplaintWorkflow({get,commit,now:Date.now,randomId:()=>randomBytes(16).toString('hex'),gmail:async id=>verified?{firebase_uid:id,requested_email:'verified@gmail.com',verified_email:'verified@gmail.com',verified_at:'2026-11-08'}:null,authUser:async id=>({uid:id,email:'internal@ssu-usc.local'}),hasPermission:(profile,user,permission)=>profile.role==='officer'&&effectiveOfficerPermissions(profile).includes(permission),draftChunks:async(id,request)=>{const rows=await sdk.getDocs(sdk.query(sdk.collection(db,'complaint_drafts',id,'entries',request,'attachmentChunks'),sdk.orderBy('index')));return rows.docs.map(s=>({id:s.id,data:s.data(),version:JSON.stringify(s.data())}))}});
  result=await service[method]({uid},{requestId:randomUUID(),...input});
 });return result;};
 return {submit:input=>run('submit',input),update:input=>run('update',input),retry:input=>run('retry',input)};
}
