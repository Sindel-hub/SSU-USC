// Exercise the trusted workflow against isolated emulator storage. Browser SDK
// writes remain denied; this adapter supplies the backend's privileged commit.
import {createRequire} from 'node:module';import {randomUUID,randomBytes} from 'node:crypto';
import {createCandidateRegistrationService} from '../../supabase/functions/_shared/candidate-registration.mjs';
const require=createRequire(process.env.SSU_RULES_TEST_DEPENDENCIES||import.meta.url),{doc,getDoc,runTransaction}=require('firebase/firestore');
export async function trustedSubmission(env,electionId,uid='s',requestId=randomUUID()){
 return env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore(),get=async path=>{const snap=await getDoc(doc(db,path));return snap.exists()?{data:snap.data(),version:JSON.stringify(snap.data())}:null};
  const commit=async operations=>runTransaction(db,async tx=>{
   const snapshots=await Promise.all(operations.map(o=>tx.get(doc(db,o.path))));
   operations.forEach((o,i)=>{const snap=snapshots[i],version=snap.exists()?JSON.stringify(snap.data()):null;if(version!==o.version)throw Error('Concurrent workflow change');});
   operations.forEach(o=>{if(o.replace)tx.set(doc(db,o.path),o.data);else tx.set(doc(db,o.path),o.data,{merge:true})});
  });
  const service=createCandidateRegistrationService({get,commit,now:Date.now,randomId:()=>randomBytes(16).toString('hex'),gmail:async()=>({firebase_uid:uid,requested_email:'verified@gmail.com',verified_email:'verified@gmail.com',verified_at:'2026-01-01'}),authUser:async()=>({uid,email:'internal@ssu-usc.local'}),validateFile:async()=>null});
  return service.submit({uid},{electionId,requestId,position:'President',campaignPhotoPath:'private/synthetic-photo',supportingDocumentPaths:[],platform:'Synthetic platform'});
 });
}
