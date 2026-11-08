import {notificationGmail,deliverNotificationQueue} from "./notification-adapter.ts";
import {adminClient,firebaseUserByUid,firestoreVersionedGet,firestoreWorkflowCommit,firestoreWorkflowQuery,randomToken,env,sendEmail,escapeHtml} from './usc-email-common.ts';
import {createCandidateRegistrationService,processCandidateNotification} from './candidate-registration.mjs';
import {effectiveOfficerPermissions} from '../../../shared/officer-permissions.js';
const supabase=adminClient();
export {notificationGmail as candidateGmail} from "./notification-adapter.ts";
async function validateFile(ref:string,kind:string,uid:string,electionId:string){
 if(ref.startsWith('firestore-media://')){
  const fileId=ref.slice('firestore-media://'.length);if(!/^[A-Za-z0-9_-]{1,128}$/.test(fileId))throw new Error('Invalid attachment.');
  const path=`browser_files/${fileId}`,file=await firestoreVersionedGet(path);
  if(!file||file.data.ownerUid!==uid||file.data.kind!==kind||!Number.isInteger(file.data.chunkCount)||file.data.chunkCount<1||file.data.chunkCount>24||file.data.size<=0||file.data.size>6*1024*1024||!(kind==='candidate-photo'?['image/jpeg','image/png','image/webp']:['application/pdf','image/jpeg','image/png','image/webp']).includes(file.data.type)||file.data.ownerEmail)throw new Error('Upload your own campaign photo and supporting documents again.');
  return {path,version:file.version,data:{kind}};
 }
 if(!ref.startsWith(`candidacy/${electionId}/${uid}/`)||ref.includes('..'))throw new Error('Attachment ownership could not be verified.');
 const {data,error}=await supabase.storage.from('usc-private-documents').download(ref);
 if(error||!data||data.size>6*1024*1024)throw new Error('Private attachment is missing or invalid.');return null;
}
async function publishPhoto(electionId:string,candidateId:string,ref:string){
 if(ref.startsWith('firestore-media://'))return {url:ref};
 const {data,error}=await supabase.storage.from('usc-private-documents').download(ref);
 if(error||!data)throw new Error('Candidate photo could not be published.');
 const extension=data.type==='image/png'?'png':data.type==='image/webp'?'webp':'jpg',path=`candidates/${electionId}/${candidateId}.${extension}`;
 const uploaded=await supabase.storage.from('usc-public-media').upload(path,data,{contentType:data.type,upsert:false});if(uploaded.error)throw new Error('Candidate photo could not be published.');
 return {url:supabase.storage.from('usc-public-media').getPublicUrl(path).data.publicUrl,cleanup:()=>supabase.storage.from('usc-public-media').remove([path])};
}
async function syncReview(electionId:string){
 for(let attempt=0;attempt<3;attempt++){
  const parent=await firestoreVersionedGet(`elections/${electionId}`);if(!parent||parent.data.finalized||parent.data.archived||parent.data.scheduleDeleted)return;
  const apps=await firestoreWorkflowQuery('applications',`elections/${electionId}`);
  if(apps.length>=490)throw new Error('Review summary requires reconciliation.');
  const active=apps.filter(a=>!a.data.removed),complete=active.length>0&&active.every(a=>['Approved','Rejected'].includes(a.data.status));
  try{await firestoreWorkflowCommit([...apps.map(a=>({path:`elections/${electionId}/applications/${a.id}`,version:a.version,data:{status:a.data.status}})),{path:`elections/${electionId}`,version:parent.version,data:{candidateReviewComplete:complete,updatedAt:Date.now()}}]);return}catch(e){if(attempt===2)throw e}
 }
}
export const candidateRegistration=createCandidateRegistrationService({get:firestoreVersionedGet,commit:firestoreWorkflowCommit,authUser:firebaseUserByUid,gmail:notificationGmail,randomId:()=>randomToken().slice(0,32),canReview:(profile:any,user:any)=>(profile.role==='admin'&&user.role==='admin')||(profile.role==='officer'&&effectiveOfficerPermissions(profile).includes('elections.review')),validateFile,publishPhoto,syncReview});
export async function deliverCandidateEvents(){return deliverNotificationQueue('candidate_email_events','candidate-application',processCandidateNotification);}
