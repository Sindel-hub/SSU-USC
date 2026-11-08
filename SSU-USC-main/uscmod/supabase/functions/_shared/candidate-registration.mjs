import {institutionalAddress} from "../usc-email/institutional-accounts.mjs";
// Backend-only application workflow. The existing email account tables and
// institutional verification remain the sole contact verification authorities.
const text=(v,n=160)=>String(v??'').trim().slice(0,n);
const norm=v=>String(v||'').trim().toLowerCase();
export const candidatePositions=['President','Vice President','Secretary','Treasurer','Auditor','Public Relations Officer','Public Relations Officer (PRO)','Business Manager','Sgt. at Arms','Department Representative'];
export const time=v=>typeof v==='number'?v:v?.toMillis?.()||Date.parse(v)||0;
export function verifiedCandidateContact(uid,profile,auth,gmail){
 if(!auth||auth.disabled||auth.uid!==uid)return null;
 const linked=norm(profile.institutionalEmail||profile.email);
 let institutionalValid=false;try{institutionalValid=institutionalAddress(linked)===linked}catch{}
 const institutional=institutionalValid&&!profile.institutionalEmailRevokedAt&&(profile.institutionalEmailVerified===true||(auth.emailVerified===true&&norm(auth.email)===linked))?linked:'';
 const personal=gmail?.firebase_uid===uid&&gmail.verified_at&&gmail.requested_email===gmail.verified_email&&/^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(gmail.verified_email||'')&&!gmail.revoked_at?gmail.verified_email:'';
 const preferred=norm(profile.primaryNotificationEmail||profile.preferredNotificationEmail);
 if(preferred&&[personal,institutional].includes(preferred))return {email:preferred,source:preferred===personal?'gmail':'institutional'};
 // Existing portal notifications prefer the connected, verified personal Gmail.
 return personal?{email:personal,source:'gmail'}:institutional?{email:institutional,source:'institutional'}:null;
}
export function candidateError(code,message){return Object.assign(new Error(message),{code});}
function id(value){const result=text(value,150);if(!/^[A-Za-z0-9:_-]{1,128}$/.test(result))throw candidateError('invalid-argument','Select a valid election and account.');return result;}
function active(profile){return profile&&profile.accountStatus==='approved'&&profile.isActive!==false&&(!profile.studentStanding||profile.studentStanding==='active');}
function open(e,start,end,now){return e&&!e.scheduleDeleted&&!e.archived&&!e.finalized&&!e.resultsPublished&&time(e[start])>0&&time(e[start])<=now&&time(e[end])>now;}
export function createCandidateRegistrationService(deps){
 const now=()=>deps.now?.()??Date.now();
 const read=deps.get;
 async function identity(user,review=false){
  const profile=await read(`users/${id(user.uid)}`);
  if(!active(profile?.data))throw candidateError('permission-denied','An active, approved account is required.');
  if(review){if(!deps.canReview(profile.data,user))throw candidateError('permission-denied','Candidate review permission is required.');}
  else if(profile.data.role!=='student'||profile.data.schoolProvisioned!==true||profile.data.candidacyApproved!==true)throw candidateError('permission-denied','Your school account must be approved for candidacy.');
  return profile;
 }
 async function contact(user,profile){return verifiedCandidateContact(user.uid,profile.data,await deps.authUser(user.uid),await deps.gmail(user.uid));}
 async function emailStatus(user){const profile=await identity(user);const found=await contact(user,profile);return {ok:true,verified:Boolean(found),source:found?.source||''};}
 async function schedule(electionId,start,end){
  const [pointer,election]=await Promise.all([read('election_config/current'),read(`elections/${electionId}`)]);
  if(pointer?.data?.electionId!==electionId||!open(election?.data,start,end,now()))throw candidateError('failed-precondition','The election changed or this registration/review window has closed.');
  return {pointer,election};
 }
 const guard=(path,record,key)=>({path,version:record.version,data:{[key]:record.data[key]}});
 async function event(uid,electionId,submissionId,revision,status,publicMessage=''){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([uid,electionId,submissionId,revision])));
  const eventId=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return {eventId,record:{uid,electionId,registrationId:uid,submissionId,revision,applicationStatus:status,publicMessage,state:'queued',attempts:0,createdAt:now(),updatedAt:now()}};
 }
 async function submit(user,input){
  const profile=await identity(user),electionId=id(input.electionId),uid=id(user.uid),path=`elections/${electionId}/applications/${uid}`;
  const requestId=id(input.requestId);
  if(!/^[a-f0-9-]{24,64}$/i.test(requestId))throw candidateError('invalid-argument','Refresh the application form and try again.');
  let previous=await read(path);
  if(previous?.data.removed&&previous.data.lastRequestId===requestId)throw candidateError('failed-precondition','That registration was deleted. Reopen the form before applying again.');
  if(previous&&!previous.data.removed){
   if(previous.data.lastRequestId===requestId)return {ok:true,electionId,applicationId:uid,status:previous.data.status,notificationState:'queued'};
   if(previous.data.status!=='Needs Information')throw candidateError('already-exists','You already submitted a candidate application for this election.');
  }
  if(!await contact(user,profile))throw candidateError('email-verification-required','Connect and verify a Gmail or institutional email before submitting.');
  const correcting=previous&&!previous.data.removed&&previous.data.status==='Needs Information';
  const {pointer,election}=await schedule(electionId,correcting?'applicationReviewStart':'registrationStart',correcting?'applicationReviewEnd':'registrationEnd');
  const position=text(input.position,80);if(!candidatePositions.includes(position))throw candidateError('invalid-argument','Select a valid candidate position.');
  const photo=text(input.campaignPhotoPath,500),documents=Array.isArray(input.supportingDocumentPaths)?input.supportingDocumentPaths:[];
  if(!photo||documents.length>8||documents.some(p=>typeof p!=='string'||p.length>500))throw candidateError('invalid-argument','Select a campaign photo and valid supporting documents.');
  const fileGuards=[];
  for(const [ref,kind]of [[photo,'candidate-photo'],...documents.map(p=>[p,'candidate-document'])]){
   const file=await deps.validateFile(ref,kind,uid,electionId);
   if(file)fileGuards.push(file);
  }
  const roster=await read(`elections/${electionId}/voterRoster/${id(profile.data.studentId)}`),p=profile.data,r=roster?.data||{};
  if(!await contact(user,profile))throw candidateError('email-verification-required','Your verified contact changed. Verify an email before submitting.');
  const stamp=now();
  if(!open(election.data,correcting?'applicationReviewStart':'registrationStart',correcting?'applicationReviewEnd':'registrationEnd',stamp))throw candidateError('failed-precondition','The registration window closed. Your application was not submitted.');
  const submissionId=correcting?previous.data.submissionId:requestId,revision=correcting?(previous.data.revision||0)+1:1;
  const notification=await event(uid,electionId,submissionId,revision,'Under Review');
  const record={electionId,registrationId:uid,applicantUid:uid,studentId:text(p.studentId),fullName:text(r.fullName||p.fullName,120),program:text(r.program||p.program),college:text(r.college||p.college),position,department:position==='Department Representative'?text(r.college||p.college):'',partylist:text(input.partylist,100),platform:text(input.platform,4000),campaignPhotoPath:photo,supportingDocumentPaths:documents,status:'Under Review',removed:false,submissionId,revision,lastRequestId:requestId,notificationEventId:notification.eventId,submittedAt:correcting?previous.data.submittedAt:stamp,updatedAt:stamp,electionSnapshot:{title:election.data.title||'USC Election',registrationStart:time(election.data.registrationStart),registrationEnd:time(election.data.registrationEnd),votingStart:time(election.data.votingStart),votingEnd:time(election.data.votingEnd)}};
  await deps.commit([guard(`users/${uid}`,profile,'role'),guard('election_config/current',pointer,'electionId'),guard(`elections/${electionId}`,election,'title'),...fileGuards,{path,version:previous?.version||null,data:record,replace:true},{path:`candidate_email_events/${notification.eventId}`,version:null,data:notification.record},{path:`audit_logs/${deps.randomId()}`,version:null,data:{actorUid:uid,electionId,action:correcting?'CANDIDACY_CORRECTED':'CANDIDACY_SUBMIT',target:path,createdAt:stamp,source:'trusted-candidate-service'}}]);
  return {ok:true,electionId,applicationId:uid,status:'Under Review',notificationState:'queued'};
 }
 async function review(user,input){
  const profile=await identity(user,true),electionId=id(input.electionId),uid=id(input.applicantUid),path=`elections/${electionId}/applications/${uid}`;
  const {pointer,election}=await schedule(electionId,'applicationReviewStart','applicationReviewEnd');
  const app=await read(path),decision=text(input.decision,30),status={approve:'Approved',reject:'Rejected','request-info':'Needs Information'}[decision];
  if(!status)throw candidateError('invalid-argument','Select approve, reject or request information.');
  if(!app||app.data.removed)throw candidateError('not-found','This registration is no longer available.');
  if(app.data.status!=='Under Review')throw candidateError('already-exists','This application already has a review decision. Refresh its status.');
  const publicMessage=text(input.publicMessage,500);
  if(decision==='request-info'&&!publicMessage)throw candidateError('invalid-argument','Describe the information the student needs to provide.');
  const submissionId=app.data.submissionId||deps.randomId(),revision=(app.data.revision||0)+1;
  const notification=await event(uid,electionId,submissionId,revision,status,publicMessage);
  const candidateId=decision==='approve'?`cand-${deps.randomId()}`:'';
  const patch={status,candidateId,reviewNote:publicMessage,reviewedByUid:user.uid,reviewedAt:now(),updatedAt:now(),submissionId,revision,notificationEventId:notification.eventId};
  let publication=null;
  let publicationGuard=null;
  if(candidateId){publicationGuard=await deps.validateFile(app.data.campaignPhotoPath,'candidate-photo',uid,electionId);publication=await deps.publishPhoto(electionId,candidateId,app.data.campaignPhotoPath);}
  try{
   if(!open(election.data,'applicationReviewStart','applicationReviewEnd',now()))throw candidateError('failed-precondition','The application review window has closed.');
   const operations=[guard(`users/${user.uid}`,profile,'role'),guard('election_config/current',pointer,'electionId'),guard(`elections/${electionId}`,election,'title'),{path,version:app.version,data:patch},{path:`candidate_email_events/${notification.eventId}`,version:null,data:notification.record},{path:`audit_logs/${deps.randomId()}`,version:null,data:{actorUid:user.uid,electionId,action:`CANDIDACY_${decision.toUpperCase()}`,target:path,createdAt:now(),source:'trusted-candidate-service'}}];
   if(publicationGuard)operations.push(publicationGuard);
   if(candidateId){const candidate=Object.fromEntries(['fullName','position','department','college','program','partylist','platform'].map(k=>[k,text(app.data[k],k==='platform'?4000:160)]));operations.push({path:`elections/${electionId}/candidates/${candidateId}`,version:null,data:{...candidate,candidateId,campaignPhotoUrl:publication.url,approved:true,published:true,approvedAt:now()}});}
   await deps.commit(operations);
  }catch(error){if(publication?.cleanup)await publication.cleanup().catch(()=>{});throw error;}
  let reviewSummaryUpdated=true;try{await deps.syncReview(electionId)}catch{reviewSummaryUpdated=false}
  return {ok:true,status,candidateId:candidateId||null,notificationState:'queued',reviewSummaryUpdated};
 }
 async function retry(user,input){
  await identity(user,true);const eventId=id(input.eventId),path=`candidate_email_events/${eventId}`,record=await read(path);
  if(!record||record.data.state!=='failed')throw candidateError('failed-precondition','Only a confirmed failed notification can be retried. Unconfirmed delivery requires administrator reconciliation.');
  await deps.commit([{path,version:record.version,data:{state:'queued',updatedAt:now(),retryByUid:user.uid}},{path:`audit_logs/${deps.randomId()}`,version:null,data:{actorUid:user.uid,action:'CANDIDATE_EMAIL_RETRY',target:path,createdAt:now(),source:'trusted-candidate-service'}}]);return {ok:true,state:'queued'};
 }
 return {emailStatus,submit,review,retry};
}

export function candidateNotificationMessage(app,election,event,portalUrl){
 const title=event.applicationStatus==='Under Review'?'Application received':event.applicationStatus==='Needs Information'?'Additional information required':`Application ${event.applicationStatus.toLowerCase()}`;
 const lines=[title,`Candidate: ${app.fullName||'Student'}`,`Election: ${election?.title||app.electionSnapshot?.title||'USC Election'}`,`Position: ${app.position}`,`Status: ${event.applicationStatus}`,`Submitted: ${time(app.submittedAt)?new Date(time(app.submittedAt)).toISOString():'Not recorded'}`];
 if(event.publicMessage)lines.push(`Message to you: ${event.publicMessage}`);
 lines.push(event.applicationStatus==='Under Review'?'Your application has been received and is awaiting review.':'Sign in to review your application and any requested actions.',`${portalUrl.replace(/\/$/,'')}/dashboard/election.html`);
 return {subject:`SSU USC: ${title}`,text:lines.join('\n\n')};
}
export async function processCandidateNotification(eventId,deps){
 const path=`candidate_email_events/${eventId}`,record=await deps.get(path);if(!record||record.data.state!=='queued')return false;
 const event=record.data,attempts=(event.attempts||0)+1;
 // Claim before doing any network delivery. Competing workers cannot both send.
 try{await deps.commit([{path,version:record.version,data:{state:'sending',attempts,updatedAt:deps.now()}}])}catch{return false}
 let sending=false;
 try{
  const app=await deps.get(`elections/${event.electionId}/applications/${event.uid}`);
  if(!app||app.data.removed||app.data.submissionId!==event.submissionId||(event.applicationStatus==='Needs Information'&&app.data.revision!==event.revision)){await deps.finish(path,{state:'cancelled',updatedAt:deps.now()});return false;}
  const profile=await deps.get(`users/${event.uid}`),auth=await deps.authUser(event.uid),gmail=await deps.gmail(event.uid);
  if(!active(profile?.data)||profile.data.role!=='student')throw candidateError('no-recipient','The student account is inactive.');
  const recipient=verifiedCandidateContact(event.uid,profile.data,auth,gmail);
  if(!recipient)throw candidateError('no-recipient','No currently verified notification email is available.');
  const election=await deps.get(`elections/${event.electionId}`),message=candidateNotificationMessage(app.data,election?.data,event,deps.portalUrl);
  sending=true;
  const providerId=await deps.send(recipient.email,message,`${eventId}-${attempts}`);
  if(!providerId)throw new Error('Delivery could not be confirmed.');
  await deps.finish(path,{state:'sent',providerId,updatedAt:deps.now()});return true;
 }catch(error){
  // A timeout/lost response can mean the provider accepted the message. Never
  // automatically retry an uncertain delivery, including a failed sent-state write.
  await deps.finish(path,{state:sending&&!error.deliveryRejected?'unknown':'failed',failureCode:sending?(error.deliveryRejected?'provider-rejected':'delivery-unconfirmed'):error.code||'recipient-unavailable',updatedAt:deps.now()}).catch(()=>{});return false;
 }
}
