import {verifiedNotificationIdentity,activeNotificationProfile} from './verified-notification-email.mjs';
import {processVerifiedNotification,retryVerifiedNotification} from './verified-notification-delivery.mjs';
export const complaintStatuses=['Submitted','Under Review','In Progress','Resolved','Closed'];
export const complaintClassifications=['Student Level','Administrative Level','Crisis Level'];
export const complaintCategories=['Facilities Concern','Academic Concern','Faculty / Staff Concern','Student Misconduct','Bullying / Harassment','Organization Concern','Other Concern'];
export const complaintCooldownMs=20000;
const types=['image/jpeg','image/png','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
export const workflowTime=value=>typeof value==='number'?value:value?.toMillis?.()||Date.parse(value)||0;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(value))throw fail('invalid-argument','Select a valid submission.');return value;};
const field=(value,min,max,label)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw fail('invalid-argument',`${label} must contain ${min}–${max} characters.`);return value.trim();};
export async function workflowHash(parts){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function classificationOf(record){if(complaintClassifications.includes(record.classification))return record.classification;return [...(Array.isArray(record.thread)?record.thread:[])].reverse().find(e=>complaintClassifications.includes(e?.classification))?.classification||'';}
const guard=(path,record,key)=>({path,version:record.version,data:{[key]:record.data[key]}});
export function validateComplaintAttachment(meta,chunks,uid){
 const size=Number(meta.attachmentSize||0),type=meta.attachmentType||'',count=Number(meta.chunkCount||0);
 if(!count){if(size||type||meta.attachmentName||chunks.length)throw fail('invalid-argument','Attachment metadata is incomplete.');return;}
 if(!Number.isInteger(count)||count<1||count>9||chunks.length!==count||!types.includes(type)||!size||size>(type.startsWith('image/')?3:5)*1024*1024)throw fail('invalid-argument','The attachment type or size is not allowed.');
 let total=0;
 chunks.forEach((chunk,index)=>{const data=chunk.data;if(data.studentUid!==uid||data.index!==index||typeof data.payload!=='string'||!data.payload.length||data.payload.length>850000||data.payload.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.payload))throw fail('invalid-argument','Attachment data is invalid.');total+=data.payload.length/4*3-(data.payload.endsWith('==')?2:data.payload.endsWith('=')?1:0);});
 if(total!==size)throw fail('invalid-argument','Attachment data is incomplete.');
}
// Preserve timestamp types used by existing Firestore ordering/pagination.
export function complaintFirestoreOperations(operations){return operations.map(operation=>{
 const data={...operation.data},casePath=/^complaints\/[^/]+$/.test(operation.path),logPath=operation.path.startsWith('complaint_case_logs/'),ratePath=operation.path.startsWith('complaint_rate_limits/');
 for(const key of casePath?['createdAt','updatedAt']:logPath?['createdAt']:ratePath?['lastSubmittedAt']:[])if(data[key]!==undefined&&workflowTime(data[key]))data[key]=new Date(workflowTime(data[key]));
 if(casePath&&Array.isArray(data.thread))data.thread=data.thread.map(entry=>({...entry,...(typeof entry.at==='number'?{at:new Date(entry.at)}:{})}));
 return {...operation,data};
});}
export function createComplaintWorkflow(deps){
 const now=()=>deps.now?.()??Date.now();
 async function submit(user,input){
  const uid=id(user.uid),requestId=id(input.requestId),complaintId=(await workflowHash(['complaint',uid,requestId])).slice(0,40),path=`complaints/${complaintId}`,receiptPath=`complaint_submission_receipts/${complaintId}`;
  if(!/^[a-f0-9-]{24,64}$/i.test(requestId))throw fail('invalid-argument','Reload the form and try again.');
  const {profile,contact}=await verifiedNotificationIdentity(uid,deps);
  const receipt=await deps.get(receiptPath);
  if(receipt){const {complaintId,complaintRef,submissionType,status,submittedAt}=receipt.data;return {ok:true,complaintId,complaintRef,submissionType,status,submittedAt,alreadyCommitted:true};}
  if(!contact)throw fail('email-verification-required','Connect and verify a Gmail or institutional email before submitting.');
  const draftPath=`complaint_drafts/${uid}/entries/${requestId}`,draft=await deps.get(draftPath),ratePath=`complaint_rate_limits/${uid}`,rate=await deps.get(ratePath);
  if(!draft||draft.data.requestId!==requestId||draft.data.expiresAtMs<=now())throw fail('failed-precondition','Your draft is missing or expired. Save it again before submitting.');
  const data=draft.data,subject=field(data.subject,3,120,'Subject'),details=field(data.details,5,1000,'Details'),submissionType=data.submissionType||'Complaint';
  if(!['Complaint','Feedback'].includes(submissionType)||!complaintCategories.includes(data.category)||!/^\d{4}-\d{2}-\d{2}$/.test(data.incidentDate||'')||Number.isNaN(Date.parse(data.incidentDate))||new Date(data.incidentDate).toISOString().slice(0,10)!==data.incidentDate)throw fail('invalid-argument','Select a valid submission type, category and date.');
  const chunks=await deps.draftChunks(uid,requestId);validateComplaintAttachment(data,chunks,uid);
  const fresh=await verifiedNotificationIdentity(uid,deps);if(!fresh.contact)throw fail('email-verification-required','Your verified contact changed. Verify an email before submitting.');
  if(fresh.profile.version!==profile.version)throw fail('aborted','Your account changed. Refresh the form before submitting.');
  const stamp=now(),remaining=Math.max(0,complaintCooldownMs-(stamp-workflowTime(rate?.data.lastSubmittedAt)));
  if(rate&&remaining>0)throw fail('resource-exhausted',`Please wait ${Math.ceil(remaining/1000)} seconds before submitting another complaint or feedback.`);
  const complaintRef=`SC-${new Date(stamp).getUTCFullYear()}-${complaintId.slice(0,12).toUpperCase()}`,eventId=await workflowHash(['complaint-mail',complaintId,1]);
  const p=profile.data,hasAttachment=chunks.length>0;
  const record={complaintRef,submissionId:requestId,submissionType,studentUid:uid,studentId:p.studentId||'',studentName:p.fullName||'Student',studentDepartment:p.department||p.program||p.course||p.college||'Not specified',subject,details,category:data.category,incidentDate:data.incidentDate,status:'Submitted',createdAt:stamp,updatedAt:stamp,revision:1,notificationEventId:eventId,notificationManaged:true,attachmentName:hasAttachment?data.attachmentName:'',attachmentPath:hasAttachment?complaintId:'',attachmentStoragePath:hasAttachment?complaintId:'',attachmentStorageBucket:hasAttachment?'firestore-chunks':'',attachmentType:hasAttachment?data.attachmentType:'',attachmentSize:hasAttachment?data.attachmentSize:0,thread:[{by:'Student',message:details,at:new Date(stamp).toISOString()}]};
  const response={complaintId,complaintRef,submissionType,status:'Submitted',submittedAt:stamp};
  const operations=[guard(`users/${uid}`,profile,'role'),guard(draftPath,draft,'requestId'),{path:ratePath,version:rate?.version||null,data:{studentUid:uid,lastSubmittedAt:stamp}},{path,version:null,data:record},{path:receiptPath,version:null,data:{...response,studentUid:uid}}, {path:`complaint_email_events/${eventId}`,version:null,data:{uid,complaintId,complaintRef,submissionType,status:'Submitted',kind:'received',changedAt:stamp,state:'queued',attempts:0,createdAt:stamp,updatedAt:stamp}}];
  chunks.forEach(chunk=>{operations.push(guard(`${draftPath}/attachmentChunks/${chunk.id}`,chunk,'index'),{path:`${path}/attachmentChunks/${chunk.id}`,version:null,data:{studentUid:uid,index:chunk.data.index,payload:chunk.data.payload}})});
  await deps.commit(operations);return {ok:true,...response,alreadyCommitted:false};
 }
 async function reviewer(user){
  const profile=await deps.get(`users/${id(user.uid)}`);
  if(!activeNotificationProfile(profile?.data)||!deps.hasPermission(profile.data,user,'complaints.review'))throw fail('permission-denied','Complaint review permission is required.');return profile;
 }
 async function update(user,input){
  const actor=await reviewer(user),complaintId=id(input.complaintId),requestId=id(input.requestId),actionId=await workflowHash(['complaint-action',user.uid,complaintId,requestId]),actionPath=`complaint_action_requests/${actionId}`;
  if(!/^[a-f0-9-]{24,64}$/i.test(requestId))throw fail('invalid-argument','Reload the case before saving your action.');
  const acknowledged=await deps.get(actionPath);if(acknowledged)return {ok:true,...acknowledged.data.response,alreadyCommitted:true};
  const path=`complaints/${complaintId}`,caseRecord=await deps.get(path);if(!caseRecord)throw fail('not-found','This submission is no longer available.');
  const before=caseRecord.data,previousClass=classificationOf(before),requestedStatus=input.status||before.status||'Submitted',requestedClass=input.classification||previousClass,feedback=String(input.feedback||input.reply||'').trim();
  if(!complaintStatuses.includes(requestedStatus)||requestedClass&&!complaintClassifications.includes(requestedClass)||feedback.length>4000)throw fail('invalid-argument','Select a supported status and classification, and keep feedback within 4000 characters.');
  const status=feedback&&requestedStatus==='Submitted'?'Under Review':requestedStatus,statusChanged=status!==(before.status||'Submitted'),classificationChanged=requestedClass!==previousClass;
  const lastFeedback=[...(Array.isArray(before.thread)?before.thread:[])].reverse().find(entry=>entry.kind==='feedback');
  if(!statusChanged&&!classificationChanged&&(!feedback||(lastFeedback?.actorUid===user.uid&&lastFeedback.message===feedback&&Boolean(lastFeedback.requestInformation)===Boolean(input.requestInformation))))return {ok:true,unchanged:true,status,classification:requestedClass};
  if(input.previousStatus!==undefined&&input.previousStatus!==(before.status||'Submitted')||input.previousClassification!==undefined&&input.previousClassification!==previousClass)throw fail('aborted','This case changed. Reload it before saving your update.');
  for(const [needed,permission]of [[statusChanged,'complaints.status'],[classificationChanged,'complaints.classify'],[Boolean(feedback),'complaints.feedback']])if(needed&&!deps.hasPermission(actor.data,user,permission))throw fail('permission-denied','Your assigned office cannot perform this complaint action.');
  if((['In Progress','Resolved','Closed'].includes(status)||feedback)&&!complaintClassifications.includes(requestedClass))throw fail('failed-precondition','Assign a complaint classification before advancing the case or sending feedback.');
  if(input.requestInformation&&!feedback)throw fail('invalid-argument','Provide the clarification request in the private USC feedback.');
  if((feedback||classificationChanged)&&before.thread!==undefined&&!Array.isArray(before.thread))throw fail('failed-precondition','The existing thread requires administrator repair. No update was saved.');
  const stamp=now(),thread=Array.isArray(before.thread)?[...before.thread]:[],revision=(Number(before.revision)||0)+1;
  if(classificationChanged)thread.push({by:'Officer',kind:'classification',actorUid:user.uid,classification:requestedClass,message:`USC classification assigned: ${requestedClass}.`,at:stamp});
  if(feedback)thread.push({by:'Officer',kind:'feedback',actorUid:user.uid,classification:requestedClass,message:feedback,requestInformation:Boolean(input.requestInformation),at:stamp});
  if(thread.length>200)throw fail('failed-precondition','This thread has reached its review limit. Contact an administrator.');
  const patch={status,updatedAt:stamp,revision,classification:requestedClass,...(feedback||classificationChanged?{thread}:{}),...(feedback?{attentionRequired:Boolean(input.requestInformation)}:{})};
  const eventNeeded=statusChanged||Boolean(feedback),eventId=eventNeeded?await workflowHash(['complaint-mail',complaintId,revision]):null;
  if(eventId)Object.assign(patch,{notificationEventId:eventId,notificationManaged:true});
  const owner=typeof before.studentUid==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(before.studentUid)?before.studentUid:'';
  const response={updated:true,status,classification:requestedClass,feedbackAdded:Boolean(feedback),replyAdded:Boolean(feedback),notificationQueued:eventNeeded&&Boolean(owner)};
  const operations=[guard(`users/${user.uid}`,actor,'role'),{path,version:caseRecord.version,data:patch},{path:actionPath,version:null,data:{actorUid:user.uid,complaintId,response,createdAt:stamp}},{path:`complaint_case_logs/${deps.randomId()}`,version:null,data:{actorUid:user.uid,complaintId,complaintRef:before.complaintRef||complaintId,action:'COMPLAINT_REVIEW_UPDATED',statusBefore:before.status||'Submitted',statusAfter:status,classificationBefore:previousClass||'Pending Classification',classificationAfter:requestedClass||'Pending Classification',createdAt:stamp,source:'trusted-complaint-service'}}];
  if(eventId)operations.push({path:`complaint_email_events/${eventId}`,version:null,data:{uid:owner,complaintId,complaintRef:before.complaintRef||complaintId,submissionType:before.submissionType||'Complaint',status,kind:input.requestInformation?'attention':feedback&&!statusChanged?'feedback':'status',changedAt:stamp,state:owner?'queued':'failed',...(owner?{}:{failureCode:'missing-owner'}),attempts:0,createdAt:stamp,updatedAt:stamp}});
  await deps.commit(operations);return {ok:true,...response};
 }
 async function retry(user,input){await reviewer(user);return retryVerifiedNotification('complaint_email_events',id(input.eventId),user,{...deps,now});}
 return {submit,update,retry};
}
export function complaintNotificationMessage(event,portalUrl){
 const subject=event.kind==='received'?'Submission received':event.kind==='attention'?'Your submission requires attention':'Submission update';
 // Deliberate allowlist: never use subject/details/thread/classification/name/email.
 const text=[`Reference: ${event.complaintRef}`,`Status: ${event.status}`,`${event.kind==='received'?'Submitted':'Updated'}: ${new Date(workflowTime(event.changedAt)).toISOString()}`,event.kind==='received'?'Your submission has been received.':event.kind==='attention'?'The USC has requested clarification. Read the private update in Student Tracklist.':'A USC update is available in Student Tracklist.',`Sign in securely to view your submission: ${portalUrl.replace(/\/$/,'')}/dashboard/tracklist.html`].join('\n\n');
 return {subject:`SSU USC: ${subject}`,text};
}
export async function processComplaintNotification(eventId,deps){
 return processVerifiedNotification('complaint_email_events',eventId,deps,async event=>{
  const record=await deps.get(`complaints/${event.complaintId}`);if(!record)return null;
  if(!event.uid||!record.data.studentUid)throw fail('missing-owner','An administrator must reconcile submission ownership before notification.');
  if(record.data.studentUid!==event.uid)return null;
  const {contact}=await verifiedNotificationIdentity(event.uid,deps);if(!contact)throw fail('no-recipient','No verified notification address is available.');
  return {recipient:contact.email,message:complaintNotificationMessage(event,deps.portalUrl)};
 });
}
