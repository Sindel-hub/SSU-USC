"use strict";
const crypto=require('node:crypto');
const M=require('./student-records-model');
const PROGRAMS=require('./student-programs.json');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function createStudentRecordHandlers({db,adminAuth,requireActiveRole,requireRecentAuth,HttpsError,sendActivation,clock=Date.now,randomToken=()=>crypto.randomBytes(32).toString('hex')}){
 const jobs=db.collection('annual_student_imports');
 const error=(code,message)=>{throw new HttpsError(code,message);};
 const validId=value=>{if(typeof value!=='string'||!/^\d{1,64}$/.test(value))error('invalid-argument','Invalid Student ID.');return value;};
 const jobId=value=>{if(typeof value!=='string'||! /^[a-zA-Z0-9]{20}$/.test(value))error('invalid-argument','Invalid import reference.');return value;};
 async function admin(request,write=false){await requireActiveRole(request,['admin']);if(write)requireRecentAuth(request);}
 async function resolve(studentId){
  const [claim,account,users]=await Promise.all([db.doc(`student_id_claims/${studentId}`).get(),db.doc(`school_accounts/${studentId}`).get(),db.collection('users').where('studentId','==',studentId).limit(3).get()]);
  const uids=[...new Set([claim.data()?.uid,account.data()?.uid,...users.docs.map(d=>d.id)].filter(Boolean))];
  if(uids.length>1)error('failed-precondition','Conflicting Student ID ownership records; reconcile these before importing.');
  if(!uids.length)return null;
  const snap=await db.doc(`users/${uids[0]}`).get();
  if(!snap.exists)error('failed-precondition','Student ID points to a missing profile. Reconcile the existing account first.');
  const profile={...snap.data(),uid:snap.id};
  if(profile.accountRemoved===true||profile.accountRemovalPending===true)error('failed-precondition','This account is removed or pending removal; use authorized account recovery.');
  if(!['student','officer'].includes(profile.role)||profile.studentId!==studentId)error('failed-precondition','Student ID belongs to another role or profile.');
  return profile;
 }
 async function getJob(value){const ref=jobs.doc(jobId(value)),s=await ref.get();if(!s.exists)error('not-found','Import not found.');return{ref,data:s.data()};}
 function audit(tx,request,action,studentId,details){tx.set(db.collection('audit_logs').doc(),{actorUid:request.auth.uid,action,targetStudentId:studentId,source:'annual-student-records',details,createdAt:new Date(clock())});}
 async function issueActivation(studentId,request){
  const profile=await resolve(validId(studentId));if(!profile||profile.activationStatus!=='pending')error('failed-precondition','Only accounts awaiting activation can receive an activation link.');
  const user=await adminAuth.getUser(profile.uid);
  const email=profile.institutionalEmail;
  if(!email||user.email?.toLowerCase()!==email.toLowerCase()||user.customClaims?.role!=='student')error('failed-precondition','Account identity needs administrator review.');
  const token=randomToken(),tokenHash=hash(token),expiresAt=clock()+86400000;
  const ref=db.doc(`student_activation_tickets/${tokenHash}`),userRef=db.doc(`users/${profile.uid}`);
  await db.runTransaction(async tx=>{
   const current=await tx.get(userRef),p=current.data();
   if(p?.activationStatus!=='pending')error('failed-precondition','Activation state changed.');
   if(p.activationSentAtMs&&clock()-p.activationSentAtMs<60000)error('resource-exhausted','Wait a minute before issuing another activation email.');
   tx.set(ref,{uid:profile.uid,studentId,email,expiresAt,state:'open',createdAt:clock()});
   tx.update(userRef,{activationTokenHash:tokenHash,activationSentAtMs:clock(),activationDelivery:'sending'});
   audit(tx,request,'STUDENT_ACTIVATION_ISSUED',studentId,{expiresAt});
  });
  try{
   await sendActivation({email,token,studentId,messageId:tokenHash});
   await userRef.update({activationDelivery:'sent'});return{sent:true};
  }catch{
   await userRef.update({activationDelivery:'unconfirmed'});
   error('unavailable','Account saved, but activation email delivery could not be confirmed. Check the email service, then explicitly resend after one minute.');
  }
 }
 async function applyRow(job,entry,index,request){
  const itemRef=job.ref.collection('results').doc(String(index)),saved=await itemRef.get();
  let result=saved.data();
  if(result?.state==='complete')return result;
  const row=entry.row,studentId=row.studentId;
  if(!result){
   const current=await resolve(studentId);
   if(M.fingerprint(current)!==entry.fingerprint)error('failed-precondition','Student record changed since preview. Create a new preview.');
   const uid=current?.uid||M.studentUid(studentId);
   let authUser;
   if(!current){
    try{authUser=await adminAuth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
    if(authUser&&(authUser.email?.toLowerCase()!==row.email||authUser.customClaims?.role&&authUser.customClaims.role!=='student'))error('failed-precondition','Provisioning identity conflict.');
    if(!authUser){
     // Unpredictable password is never returned, exported, logged or emailed.
     authUser=await adminAuth.createUser({uid,email:row.email,emailVerified:false,password:crypto.randomBytes(32).toString('base64url'),displayName:row.fullName,disabled:true});
    }
    await adminAuth.setCustomUserClaims(uid,{...authUser.customClaims,role:'student',annualStudentId:studentId});
   }else{
    authUser=await adminAuth.getUser(uid);
    if(row.email&&![current.institutionalEmail,current.email,authUser.email].filter(Boolean).map(v=>v.toLowerCase()).includes(row.email))error('failed-precondition','Existing email identity changed since preview.');
   }
   const userRef=db.doc(`users/${uid}`),claimRef=db.doc(`student_id_claims/${studentId}`),accountRef=db.doc(`school_accounts/${studentId}`);
   await db.runTransaction(async tx=>{
    const [s,claim,account,item]=await Promise.all([tx.get(userRef),tx.get(claimRef),tx.get(accountRef),tx.get(itemRef)]);
    if(item.exists){result=item.data();return;}
    if((claim.data()?.uid&&claim.data().uid!==uid)||(account.data()?.uid&&account.data().uid!==uid))error('failed-precondition','Student ID ownership changed.');
    const before=s.exists?{...s.data(),uid:s.id}:null;
    if(M.fingerprint(before)!==entry.fingerprint)error('failed-precondition','Student record changed since preview. Create a new preview.');
    const academic=M.nextAcademicProfile(before,row,job.data.academicYear);
    const createFields=before?{}:{uid,studentId,role:'student',accountStatus:'pending',activationStatus:'pending',institutionalEmail:row.email,email:row.email,authEmail:row.email,institutionalEmailVerified:false,schoolProvisioned:true,isVerifiedStudent:false,createdAt:new Date(clock())};
    const active=before?academic.isActive:false;
    const managedDisable=row.status!=='active'||!before||before.activationStatus==='pending';
    const preserveDisabled=before&&before.standingManagedDisabled!==true&&(authUser.disabled===true||(before.isActive===false&&before.studentStanding==='active'));
    if(current&&authUser.customClaims?.role==='admin')error('failed-precondition','Protected authentication identity.');
    result={studentId,uid,action:before?'updated':'created',state:'auth-pending',active:active&&!preserveDisabled,managedDisable,needsActivation:!before,appliedAt:clock()};
    tx.set(userRef,{...createFields,...academic,isActive:result.active,standingManagedDisabled:managedDisable||before?.standingManagedDisabled===true,updatedAt:new Date(clock()),updatedAtMs:clock(),academicRevision:(before?.academicRevision||0)+1,lastAnnualImportId:job.ref.id,...(row.status!=='active'?{isVerifiedStudent:false}:{})},{merge:true});
    tx.set(claimRef,{studentId,uid,updatedAt:new Date(clock())},{merge:true});
    tx.set(accountRef,{studentId,uid,fullName:row.fullName,college:row.department,program:row.program,yearLevel:academic.yearLevel,academicYear:job.data.academicYear,studentStanding:row.status,active:result.active,isActive:result.active,...(!before?{institutionalEmail:row.email,authEmail:row.email,loginEmail:row.email}:{}),updatedAt:new Date(clock())},{merge:true});
    tx.set(db.doc(`student_masterlist/${studentId}`),{studentId,fullName:row.fullName,college:row.department,program:row.program,yearLevel:academic.yearLevel,studentStanding:row.status,enrollmentStatus:M.enrollment(row.status),academicYear:job.data.academicYear,eligible:result.active,updatedAt:new Date(clock())},{merge:true});
    if(!before){
     tx.set(db.doc(`login_aliases/id_${studentId}`),{uid,authEmail:row.email,kind:'studentId',updatedAt:new Date(clock())});
     // Email login is supported by Auth; verified profile state is set only after activation.
    }
    tx.set(userRef.collection('academic_history').doc(job.ref.id),{academicYear:job.data.academicYear,before:before?M.academicSnapshot(before):null,after:M.academicSnapshot({...academic,studentId}),importId:job.ref.id,actorUid:request.auth.uid,recordedAt:clock()});
    tx.set(itemRef,result);audit(tx,request,before?'STUDENT_ANNUAL_UPDATED':'STUDENT_BULK_CREATED',studentId,{academicYear:job.data.academicYear,importId:job.ref.id,status:row.status});
   });
  }
  // Auth and Firestore are different systems. The journal resumes failed Auth sync
  // without writing another history entry or creating a second account.
  const latest=(await db.doc(`users/${result.uid}`).get()).data();
  const active=latest?.isActive===true&&latest.accountStatus==='approved'&&latest.studentStanding==='active'&&latest.activationStatus!=='pending';
  await adminAuth.updateUser(result.uid,{disabled:!active});
  if(!active)await adminAuth.revokeRefreshTokens(result.uid);
  if(latest?.lastAnnualImportId===job.ref.id)await db.doc(`users/${result.uid}`).update({standingManagedDisabled:result.managedDisable});
  result={...result,state:'complete',completedAt:clock()};await itemRef.set(result);
  if(result.needsActivation){
   try{await issueActivation(studentId,request);result.emailStatus='sent';}
   catch{result.emailStatus='unconfirmed';}
   await itemRef.set(result);
  }
  return result;
 }
 return{
  async studentAnnualPreview(request){
   await admin(request,true);let rows,year;
   try{year=M.academicYear(request.data?.academicYear);rows=M.normalizeRows(request.data?.rows);}catch(e){error('invalid-argument',e.message);}
   if(request.data?.authorized!==true)error('failed-precondition','Confirm this is an authorized SSU-USC student list.');
   const entries=[];
   for(let i=0;i<rows.length;i++){
    const row=rows[i];if(row.error){entries.push({line:i+2,error:row.error,studentId:row.studentId});continue;}
    try{
     if(!PROGRAMS[row.department]?.includes(row.program))error('invalid-argument','Program does not match the selected department.');
     const current=await resolve(row.studentId);
     M.nextAcademicProfile(current,row,year);
     if(!current&&!row.email)error('invalid-argument','An email address is required for a new account.');
     if(current&&row.email){const authUser=await adminAuth.getUser(current.uid);if(![current.institutionalEmail,current.email,authUser.email].filter(Boolean).map(v=>v.toLowerCase()).includes(row.email))error('failed-precondition','Email changes require a separate verified account change.');}
     if(!current){try{const found=await adminAuth.getUserByEmail(row.email);if(found.uid!==M.studentUid(row.studentId))error('already-exists','Email already belongs to another account.');}catch(e){if(e.code!=='auth/user-not-found')throw e;}}
     entries.push({line:i+2,row,uid:current?.uid||null,fingerprint:M.fingerprint(current),action:current?'update':'create',warning:current?.accountStatus==='suspended'?'Suspended account will remain blocked.':''});
    }catch(e){entries.push({line:i+2,studentId:row.studentId,error:e.code==='auth/internal-error'?'Account lookup failed. Retry later.':e.message});}
   }
   const ref=jobs.doc(),hasErrors=entries.some(e=>e.error);
   await ref.set({academicYear:year,entries,createdBy:request.auth.uid,createdAt:clock(),expiresAt:clock()+86400000,status:hasErrors?'invalid':'reviewed',count:entries.length});
   return{importId:ref.id,academicYear:year,entries:entries.map(({fingerprint,...e})=>e),hasErrors};
  },
  async studentAnnualApply(request){
   await admin(request,true);const job=await getJob(request.data?.importId);
   if(job.data.status!=='reviewed'||clock()>=job.data.expiresAt)error('failed-precondition','Import preview is invalid or expired. Create a new preview.');
   const start=request.data?.start;
   if(!Number.isInteger(start)||start<0||start>=job.data.entries.length)error('invalid-argument','Invalid import offset.');
   const results=[];
   for(let i=start;i<Math.min(start+10,job.data.entries.length);i++){
    try{results.push({index:i,...await applyRow(job,job.data.entries[i],i,request)});}
    catch(e){results.push({index:i,studentId:job.data.entries[i].row.studentId,state:'failed',message:e.code?.startsWith('auth/')?'Authentication synchronization failed. Check the account and retry.':e.message});}
   }
   return{results,next:start+10<job.data.entries.length?start+10:null};
  },
  async studentAnnualJob(request){
   await admin(request);const job=await getJob(request.data?.importId),results=await job.ref.collection('results').get();
   return{importId:job.ref.id,academicYear:job.data.academicYear,count:job.data.count,status:job.data.status,entries:job.data.entries.map(({fingerprint,...e})=>e),results:results.docs.map(d=>({index:Number(d.id),...d.data()}))};
  },
  async studentActivationResend(request){await admin(request,true);return issueActivation(request.data?.studentId,request);},
  async studentActivateAccount(request){
   const{token,password}=request.data||{};
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>128)error('invalid-argument','Use a valid activation link and a password of 12–128 characters.');
   const ref=db.doc(`student_activation_tickets/${hash(token)}`),lease=randomToken();let ticket;
   await db.runTransaction(async tx=>{
    const s=await tx.get(ref);ticket=s.data();
    if(!ticket||ticket.expiresAt<=clock()||ticket.state==='used')error('failed-precondition','Activation link is invalid, expired, or already used. Ask the administrator for a new link.');
    const profile=await tx.get(db.doc(`users/${ticket.uid}`));
    if(profile.data()?.activationStatus!=='pending'||profile.data()?.activationTokenHash!==ref.id||profile.data()?.institutionalEmail!==ticket.email)error('failed-precondition','Activation link is no longer valid.');
    if(ticket.leaseUntil>clock())error('aborted','Activation is already processing. Please wait a minute before retrying.');
    tx.update(ref,{state:'processing',lease,leaseUntil:clock()+60000});
   });
   const authUser=await adminAuth.getUser(ticket.uid);
   if(authUser.email?.toLowerCase()!==ticket.email||authUser.customClaims?.role!=='student')error('failed-precondition','Account identity requires administrator review.');
   // Ticket possession verifies the imported mailbox. Auth/Firestore finalization
   // is resumable: never consume the ticket before both systems are ready.
   await adminAuth.updateUser(ticket.uid,{password,emailVerified:true});
   await ref.update({state:'auth-pending'});
   const userRef=db.doc(`users/${ticket.uid}`),current=(await userRef.get()).data();
   const active=current?.studentStanding==='active'&&current.accountStatus==='pending';
   try{
    await adminAuth.updateUser(ticket.uid,{disabled:!active});
    await db.runTransaction(async tx=>{
     const[s,p]=await Promise.all([tx.get(ref),tx.get(userRef)]);const profile=p.data();
     if(s.data()?.lease!==lease||profile?.activationTokenHash!==ref.id||profile?.activationStatus!=='pending'||(profile.studentStanding==='active'&&profile.accountStatus==='pending')!==active)error('failed-precondition','Activation state changed. Retry or ask the administrator for a new link.');
     tx.update(userRef,{activationStatus:'complete',institutionalEmailVerified:true,activationCompletedAt:clock(),activationTokenHash:null,accountStatus:profile.accountStatus==='pending'?'approved':profile.accountStatus,isActive:active,standingManagedDisabled:!active});
     tx.set(db.doc(`school_accounts/${ticket.studentId}`),{active,isActive:active},{merge:true});
     tx.set(db.doc(`student_masterlist/${ticket.studentId}`),{eligible:active},{merge:true});
     tx.update(ref,{state:'used',usedAt:clock()});
     tx.set(db.collection('audit_logs').doc(),{actorUid:ticket.uid,action:'STUDENT_ACCOUNT_ACTIVATED',targetStudentId:ticket.studentId,createdAt:new Date(clock())});
    });
   }catch(e){const latest=(await userRef.get()).data();if(latest?.activationStatus!=='complete'||latest.isActive!==true)await adminAuth.updateUser(ticket.uid,{disabled:true}).catch(()=>{});throw e;}

   return{activated:true,canAccess:active};
  },
  async studentRecordsList(request){
   await admin(request);let q=db.collection('users').where('role','in',['student','officer']).orderBy('__name__').limit(51);
   if(request.data?.after){if(typeof request.data.after!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(request.data.after))error('invalid-argument','Invalid cursor.');q=q.startAfter(request.data.after);}
   if(request.data?.studentId){const p=await resolve(validId(request.data.studentId));return{students:p?[publicProfile(p)]:[],next:null};}
   const docs=(await q.get()).docs;
   return{students:docs.slice(0,50).map(d=>publicProfile({...d.data(),uid:d.id})),next:docs.length>50?docs[49].id:null};
  },
  async studentRecordDetail(request){
   await admin(request);const profile=await resolve(validId(request.data?.studentId));if(!profile)error('not-found','Student record not found.');
   const history=await db.doc(`users/${profile.uid}`).collection('academic_history').orderBy('recordedAt','desc').limit(100).get();
   const complaints=await db.collection('complaints').where('studentUid','==',profile.uid).limit(100).get();
   const signins=await db.doc(`student_signin_stats/${profile.uid}`).get();
   // Existing collection-group registration queries use only studentUid. An index
   // may be required in staging; return an explicit limitation rather than invent data.
   let participation=[],activityWarning='';
   try{const docs=await db.collectionGroup('registrations').where('studentUid','==',profile.uid).limit(100).get();participation=docs.docs.filter(d=>/^(events|programs)\//.test(d.ref.path)).map(d=>({source:d.ref.path.split('/')[0],itemId:d.ref.path.split('/')[1],status:d.data().status||'registered',registeredAt:millis(d.data().registeredAt)}));}catch{activityWarning='Event/program participation could not be loaded; verify the registrations collection-group index.';}
   return{profile:publicProfile(profile),history:history.docs.map(d=>d.data()),complaints:complaints.docs.map(d=>({id:d.id,subject:d.data().subject||'',status:d.data().status||'',createdAt:millis(d.data().createdAt)})),signins:signins.exists?{count:signins.data().signInCount||signins.data().count||0,lastSignInAt:millis(signins.data().lastSignInAt||signins.data().lastSignInAtMs)}:null,participation,activityWarning,limit:100};
  }
 };
}
function millis(value){return typeof value?.toMillis==='function'?value.toMillis():typeof value==='number'?value:0;}
function publicProfile(p){return Object.fromEntries(['uid','studentId','fullName','college','program','yearLevel','academicYear','studentStanding','accountStatus','isActive','activationStatus','activationDelivery','institutionalEmail','role'].map(k=>[k,p[k]??null]));}
module.exports={createStudentRecordHandlers};
