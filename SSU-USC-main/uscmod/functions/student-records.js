"use strict";
const crypto=require('node:crypto');
const M=require('./student-records-model');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const identityName=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function createStudentRecordHandlers({db,adminAuth,requireActiveRole,requireRecentAuth,HttpsError,sendActivation,clock=Date.now,randomToken=()=>crypto.randomBytes(32).toString('hex')}){
 const jobs=db.collection('annual_student_imports');
 const error=(code,message)=>{throw new HttpsError(code,message);};
 const validId=value=>{if(typeof value!=='string'||!/^\d{1,64}$/.test(value))error('invalid-argument','Invalid Student ID.');return value;};
 const jobId=value=>{if(typeof value!=='string'||! /^[a-zA-Z0-9]{20}$/.test(value))error('invalid-argument','Invalid import reference.');return value;};
 async function admin(request,write=false){await requireActiveRole(request,['admin']);if(write)requireRecentAuth(request);}
 async function resolve(studentId){
  const [claim,account,alias,users]=await Promise.all([db.doc(`student_id_claims/${studentId}`).get(),db.doc(`school_accounts/${studentId}`).get(),db.doc(`login_aliases/id_${studentId}`).get(),db.collection('users').where('studentId','==',studentId).get()]);
  const uids=[...new Set([claim.data()?.uid,account.data()?.uid,alias.data()?.uid,...users.docs.filter(d=>!d.data().idReservationsReleased).map(d=>d.id)].filter(Boolean))];
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
 async function getRecord(studentId){
  const index=(await db.doc(`student_record_ids/${studentId}`).get()).data();
  if(!index) return null;
  const saved=await db.doc(`student_records/${index.uid}`).get();
  if(!saved.exists || saved.data().studentId!==studentId)error('failed-precondition','Student record ownership needs administrator review.');
  return saved.data();
 }
 function verifyIdentity(current,record,row){
  const known=record||current;
  const expected=new Set([row.fullName,[row.firstName,row.middleName,row.lastName,row.suffix].filter(Boolean).join(' ')].filter(Boolean).map(identityName));
  if(known&&!expected.has(identityName(known.fullName)))error('failed-precondition','Student ID and name do not match the existing identity. Review this record before importing.');
  if(record&&current&&record.uid!==current.uid)error('failed-precondition','Student ID is linked to a different permanent account.');
 }
 const revision=record=>record?.recordRevision||record?.lastAnnualImportId||null;
 const correctionOptions=job=>({allowOlderYear:job.data.correction===true&&typeof job.data.correctionReason==='string'&&job.data.correctionReason.length>=4&&job.data.correctionReason.length<=500});
 async function restoreSource(profile,row){
  if(!profile||!['graduated','dropped'].includes(profile.studentStanding)||!['active','undergraduate'].includes(row.studentStatus)||row.status!=='active')return null;
  if(profile.accountStatus!=='approved'||profile.isActive!==false||profile.accountRemoved||profile.accountRemovalPending||!profile.standingManagedDisabled||['pending','processing'].includes(profile.activationStatus))error('failed-precondition','This restricted account is not eligible for import access restoration. Review it in User Directory.');
  const sourceId=profile.importRestrictionId||profile.droppedImportId||profile.graduationImportId;
  const source=await getJob(sourceId);
  const index=source.data.entries.findIndex(e=>e.row?.studentId===row.studentId&&e.row.studentStatus===profile.studentStanding);
  const result=index>=0?(await source.ref.collection('results').doc(String(index)).get()).data():null;
  if(!result||result.uid!==profile.uid||result.state!=='complete')error('failed-precondition','The disabling import must have completed for this same account before access restoration.');
  return sourceId;
 }
 async function finishImportRestriction(itemRef,result,request){
  const userRef=db.doc(`users/${result.uid}`),standing=result.dropped?'dropped':'graduated';
  const assertRestricted=profile=>{if(!profile||profile.studentId!==result.studentId||!['student','officer'].includes(profile.role)||profile.accountRemoved||profile.accountRemovalPending||profile.accessRestoreImportId||profile.studentStanding!==standing||profile.isActive!==false)error('failed-precondition','Import access state changed. Review the account before retrying.');};
  assertRestricted((await userRef.get()).data());
  await adminAuth.updateUser(result.uid,{disabled:true});
  await adminAuth.revokeRefreshTokens(result.uid);
  return db.runTransaction(async tx=>{const [user,item]=await Promise.all([tx.get(userRef),tx.get(itemRef)]);if(item.data()?.state==='complete')return item.data();assertRestricted(user.data());const complete={...result,state:'complete',message:`${standing==='dropped'?'Dropped':'Graduated'} — portal access revoked.`,accessRevokedAt:clock()};tx.set(itemRef,complete);audit(tx,request,result.dropped?'SCL_DROPPED_ACCESS_REVOKED':'SCL_GRADUATION_ACCESS_REVOKED',result.studentId,{importId:result.importId,uid:result.uid});return complete;});
 }
 async function finishAccessRestore(itemRef,result,request){
  const userRef=db.doc(`users/${result.uid}`);
  const assertPending=profile=>{if(!profile||M.fingerprint({...profile,uid:result.uid})!==result.restoreFingerprint||profile.accessRestoreImportId!==result.importId||profile.accountStatus!=='approved'||profile.isActive!==false||profile.accountRemoved||profile.accountRemovalPending)error('failed-precondition','Account changed during restoration. Review it before retrying.');};
  try{
   const [item,user]=await Promise.all([itemRef.get(),userRef.get()]);if(item.data()?.state==='complete')return item.data();assertPending(user.data());
   await adminAuth.updateUser(result.uid,{disabled:false});
   await adminAuth.revokeRefreshTokens(result.uid);
   return await db.runTransaction(async tx=>{
    const [saved,current]=await Promise.all([tx.get(itemRef),tx.get(userRef)]);if(saved.data()?.state==='complete')return saved.data();assertPending(current.data());
    tx.update(userRef,{studentStanding:'active',isActive:true,enrollmentStatus:'Enrolled',standingManagedDisabled:false,accessRestoreImportId:null});
    tx.set(db.doc(`school_accounts/${result.studentId}`),{studentStanding:'active',isActive:true,active:true},{merge:true});
    tx.set(db.doc(`student_masterlist/${result.studentId}`),{studentStanding:'active',eligible:true},{merge:true});
    const complete={...result,state:'complete',message:'Academic correction applied; approved import-disabled account access restored. Verification and candidacy were not granted.',accessRestoredAt:clock()};
    tx.set(itemRef,complete);audit(tx,request,'SCL_IMPORT_ACCESS_RESTORED',result.studentId,{importId:result.importId,sourceImportId:result.restoreFromImportId});return complete;
   });
  }catch(e){
   const latest=(await itemRef.get()).data();if(latest?.state==='complete')return latest;
   // Auth may have been enabled before a final profile-write failure; keep retries fail-closed.
   await adminAuth.updateUser(result.uid,{disabled:true});throw e;
  }
 }
 async function applyRow(job,entry,index,request){
  const itemRef=job.ref.collection('results').doc(String(index)), prior=(await itemRef.get()).data();
  if(prior?.state==='complete')return prior;
  if(prior?.state==='access-pending')return finishImportRestriction(itemRef,prior,request);
  if(prior?.state==='restore-pending')return finishAccessRestore(itemRef,prior,request);
  const {row}=entry,{studentId}=row;
  const account=await resolve(studentId), saved=await getRecord(studentId);
  if(!entry.reconciled)verifyIdentity(account,saved,row);
  if(M.fingerprint(account)!==entry.fingerprint||revision(saved)!==(entry.recordRevision||null))error('failed-precondition','Student record changed since preview. Create a new preview.');
  const uid=account?.uid||saved?.uid||crypto.randomUUID();
  const userRef=db.doc(`users/${uid}`),recordRef=db.doc(`student_records/${uid}`);
  const indexRef=db.doc(`student_record_ids/${studentId}`),masterRef=db.doc(`student_masterlist/${studentId}`);
  const applied=await db.runTransaction(async tx=>{
   const [user,record,identity,claim,school,alias,item]=await Promise.all([
    tx.get(userRef),tx.get(recordRef),tx.get(indexRef),tx.get(db.doc(`student_id_claims/${studentId}`)),
    tx.get(db.doc(`school_accounts/${studentId}`)),tx.get(db.doc(`login_aliases/id_${studentId}`)),tx.get(itemRef)
   ]);
   if(['complete','access-pending','restore-pending'].includes(item.data()?.state))return item.data();
   if([identity,claim,school,alias].some(s=>s.data()?.uid&&s.data().uid!==uid))error('failed-precondition','Student ID ownership changed.');
   const current=user.exists?{...user.data(),uid}:null,before=record.data();
   if(M.fingerprint(current)!==entry.fingerprint||revision(before)!==(entry.recordRevision||null))error('failed-precondition','Student record changed since preview. Create a new preview.');
   if(current?.accessRestoreImportId)error('failed-precondition','Resume the pending access restoration before importing this student again.');
   if(before?.provisioning==='issuing')error('failed-precondition','Account issuance is in progress. Retry this record after issuance.');
   const {isActive,studentStanding,...academic}=M.nextAcademicProfile(before||current,row,job.data.academicYear,correctionOptions(job));
   const names=Object.fromEntries(['firstName','lastName','middleName','suffix'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
   const updatedAtMs=clock(),accountUid=current?.uid||null;
   const data={...academic,...names,uid,studentId,role:current?.role||'student',studentStanding:['graduated','dropped'].includes(row.studentStatus)?row.studentStatus:entry.restoreFromImportId?'active':current?.studentStanding||before?.studentStanding||studentStanding,
    enrollmentStatus:row.enrollmentStatus||M.enrollment(row.status),institutionalEmail:row.email||before?.institutionalEmail||current?.institutionalEmail||'',
    accountUid,provisioning:before?.provisioning||null,lastAnnualImportId:job.ref.id,recordRevision:job.ref.id,updatedAtMs};
   // The imported record owns academic year/level; mirror them without touching account access or office identity.
   if(current){
    tx.update(userRef,{yearLevel:data.yearLevel,academicYear:data.academicYear,studentRecordId:uid,academicRevision:job.ref.id});
    tx.set(db.doc(`school_accounts/${studentId}`),{uid,studentId,yearLevel:data.yearLevel,academicYear:data.academicYear},{merge:true});
   }
   const graduation=row.studentStatus==='graduated',dropped=row.studentStatus==='dropped',restrict=graduation||dropped;
   if(entry.restoreFromImportId){
    if(!current||job.data.correction!==true||job.data.restoreAccess!==true||current.accountStatus!=='approved'||current.isActive!==false||!current.standingManagedDisabled||(current.importRestrictionId||current.droppedImportId||current.graduationImportId)!==entry.restoreFromImportId)error('failed-precondition','Import-disabled access changed. Generate a new correction preview.');
    tx.update(userRef,{accessRestoreImportId:job.ref.id});
   }
   if(restrict&&current){
    tx.update(userRef,{studentStanding:row.studentStatus,isActive:false,isVerifiedStudent:false,candidacyApproved:false,enrollmentStatus:'Not Enrolled',enrollmentClassification:data.enrollmentStatus,standingManagedDisabled:true,importRestrictionId:job.ref.id,...(dropped?{droppedImportId:job.ref.id,droppedAtMs:clock()}:{graduationImportId:job.ref.id,graduatedAtMs:clock()})});
    tx.set(db.doc(`school_accounts/${studentId}`),{uid,studentId,studentStanding:row.studentStatus,active:false,isActive:false},{merge:true});
   }
   tx.set(indexRef,{uid});
   tx.set(recordRef,data,{merge:true});
   tx.set(masterRef,{studentId,...academic,...names,enrollmentClassification:data.enrollmentStatus,...(restrict?{studentStanding:row.studentStatus,eligible:false}:{}),studentRecordId:uid,updatedAt:new Date(updatedAtMs)},{merge:true});
   const previous=before||current,after=M.academicSnapshot(data);
   if(!previous||JSON.stringify(M.academicSnapshot(previous))!==JSON.stringify(after))tx.set(userRef.collection('academic_history').doc(job.ref.id),{
    academicYear:job.data.academicYear,...(job.data.correction?{correction:true,correctionReason:job.data.correctionReason}:{}),before:previous?M.academicSnapshot(previous):null,after,importId:job.ref.id,actorUid:request.auth.uid,recordedAt:updatedAtMs
   });
   const restoreProfile=entry.restoreFromImportId?{...current,yearLevel:data.yearLevel,academicYear:data.academicYear,studentRecordId:uid,academicRevision:job.ref.id,accessRestoreImportId:job.ref.id}:null;
   const result={studentId,uid,action:job.data.correction?'academic-corrected':before?'updated':'record-saved',state:restrict&&current?'access-pending':restoreProfile?'restore-pending':'complete',...(restrict?{...(dropped?{dropped:true}:{graduation:true}),importId:job.ref.id,message:current?'Academic record saved; access revocation pending.':`${dropped?'Dropped':'Graduated'} — no account access can be issued.`}:{}),...(restoreProfile?{importId:job.ref.id,restoreFromImportId:entry.restoreFromImportId,restoreFingerprint:M.fingerprint(restoreProfile)}:{}),appliedAt:updatedAtMs};
   tx.set(itemRef,result);
   audit(tx,request,dropped?'SCL_DROPPED_RECORDED':graduation?'SCL_GRADUATION_RECORDED':job.data.correction?'SCL_CORRECTION_APPLIED':'SCL_RECORD_APPLIED',studentId,{academicYear:job.data.academicYear,importId:job.ref.id,...(job.data.correction?{reason:job.data.correctionReason,restoreAccess:Boolean(entry.restoreFromImportId)}:{})});
   return result;
  });
  return applied.state==='access-pending'?finishImportRestriction(itemRef,applied,request):applied.state==='restore-pending'?finishAccessRestore(itemRef,applied,request):applied;
 }

 function inPersonTicket(tx,profile,request){
  const token=randomToken(),tokenHash=hash(token),now=clock(),expiresAt=now+86400000;
  tx.create(db.doc(`student_activation_tickets/${tokenHash}`),{
   uid:profile.uid,studentId:profile.studentId,email:profile.authEmail,verifyMailbox:false,expiresAt,state:'open',createdAt:now
  });
  audit(tx,request,'STUDENT_IN_PERSON_ACTIVATION_ISSUED',profile.studentId,{expiresAt});
  return {token,expiresAt,fields:{activationTokenHash:tokenHash,activationSentAtMs:now,activationDelivery:'in-person',activationMethod:'in-person'}};
 }

 async function registerStudent(request){
  await admin(request,true);
  const data=request.data||{},studentId=validId(data.studentId);
  if(data.verifiedInPerson!==true)error('failed-precondition','Confirm that you verified the student in person.');
  const existing=await resolve(studentId);
  if(existing){
   if(data.reissue!==true)error('already-exists','An account already exists for this Student ID.');
   return db.runTransaction(async tx=>{
    const userRef=db.doc(`users/${existing.uid}`),profile=(await tx.get(userRef)).data();
    if(profile?.studentId!==studentId||profile.role!=='student'||profile.accountStatus!=='pending'||profile.activationStatus!=='pending'||profile.activationMethod!=='in-person'||profile.accountRemoved||profile.accountRemovalPending)
     error('failed-precondition','This account cannot receive an in-person activation link.');
    if(clock()-profile.activationSentAtMs<60000)error('resource-exhausted','Wait one minute before replacing the activation link.');
    const {token,expiresAt,fields}=inPersonTicket(tx,{...profile,uid:existing.uid},request);
    tx.update(userRef,fields);
    return {token,expiresAt};
   });
  }
  if(data.reissue===true)error('failed-precondition','No issued account was found.');
  const record=await getRecord(studentId);
  if(!record||record.accountUid||record.studentStanding!=='active'||!data.recordRevision||revision(record)!==data.recordRevision)
   error('failed-precondition','Look up the current eligible masterlist record before issuing the account.');
  const {uid}=record;
  const email=record.institutionalEmail||`${studentId}@student.ssu-usc.local`;
  const userRef=db.doc(`users/${uid}`),recordRef=db.doc(`student_records/${uid}`),indexRef=db.doc(`student_record_ids/${studentId}`);
  const claimRef=db.doc(`student_id_claims/${studentId}`),schoolRef=db.doc(`school_accounts/${studentId}`),aliasRef=db.doc(`login_aliases/id_${studentId}`);
  const emailRef=db.doc(`login_aliases/email_${hash(email)}`);
  const duplicateNames=await db.collection('users').where('fullName','==',record.fullName).limit(2).get();
  if(duplicateNames.docs.some(doc=>doc.id!==uid&&!doc.data().idReservationsReleased))
   error('already-exists','This name is already linked to a different account. Verify both Student IDs.');
  const normalizedName=identityName(record.fullName),nameRef=db.doc(`student_name_claims/${hash(normalizedName)}`);
  const ownership=async tx=>Promise.all([tx.get(recordRef),tx.get(indexRef),tx.get(userRef),tx.get(claimRef),tx.get(schoolRef),tx.get(aliasRef),tx.get(emailRef),tx.get(nameRef)]);
  function checkOwnership([saved,index,profile,...reservations]){
   if(revision(saved.data())!==data.recordRevision||saved.data()?.accountUid||saved.data()?.studentStanding!=='active'||index.data()?.uid!==uid||profile.exists||reservations.some(s=>s.exists&&s.data().uid!==uid))
    error('failed-precondition','Record or account ownership changed. Look up the student again.');
  }
  await db.runTransaction(async tx=>{
   const snaps=await ownership(tx);
   checkOwnership(snaps);
   const name=snaps.at(-1);
   if(!name.exists)tx.create(nameRef,{nameKey:nameRef.id,normalizedName,uid,studentId,fullName:record.fullName,accountRole:'student',createdBy:request.auth.uid,createdAt:new Date(clock())});
   tx.update(recordRef,{provisioning:'issuing'});
  });
  let authUser;
  try{authUser=await adminAuth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
  if(!authUser){
   try{authUser=await adminAuth.createUser({uid,email,password:crypto.randomBytes(32).toString('base64url'),emailVerified:false,displayName:record.fullName,disabled:true});}
   catch(e){
    if(e.code==='auth/email-already-exists'){
     const owner=await adminAuth.getUserByEmail(email);
     if(owner.uid!==uid){
      await db.runTransaction(async tx=>{
       const snaps=await ownership(tx);
       checkOwnership(snaps);
       if(snaps[0].data()?.provisioning==='issuing'){
        tx.update(recordRef,{provisioning:null});
       }
      });
      error('already-exists','This email belongs to another account. Correct the SCL record before retrying.');
     }
     authUser=owner;
    }else if(e.code==='auth/uid-already-exists')authUser=await adminAuth.getUser(uid);
    else throw e;
   }
  }
  if(authUser.email?.toLowerCase()!==email||authUser.disabled!==true||(authUser.customClaims?.role&&authUser.customClaims.role!=='student'))
   error('failed-precondition','Provisioning identity conflict. Review the existing Auth account.');
  await adminAuth.setCustomUserClaims(uid,{...authUser.customClaims,role:'student',annualStudentId:studentId});
  return db.runTransaction(async tx=>{
   checkOwnership(await ownership(tx));
   const {fullName,college,program,yearLevel,academicYear,studentStanding,enrollmentStatus}=record;
   const names=Object.fromEntries(['firstName','middleName','lastName','suffix'].filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
   const academic={...names,fullName,college,program,yearLevel,academicYear,studentStanding,enrollmentStatus:M.enrollment(studentStanding),enrollmentClassification:enrollmentStatus};
   const contact=record.institutionalEmail||'';
   const {token,expiresAt,fields}=inPersonTicket(tx,{uid,studentId,authEmail:email},request);
   tx.create(userRef,{...academic,...fields,uid,studentId,studentRecordId:uid,role:'student',accountStatus:'pending',activationStatus:'pending',
    institutionalEmail:contact,email:contact,authEmail:email,institutionalEmailVerified:false,schoolProvisioned:true,isVerifiedStudent:false,isActive:false,createdAt:new Date(clock())});
   tx.set(claimRef,{studentId,uid});
   tx.set(schoolRef,{studentId,uid,...academic,institutionalEmail:contact,authEmail:email,loginEmail:email,active:false,isActive:false},{merge:true});
   tx.set(aliasRef,{uid,authEmail:email,kind:'studentId',updatedAt:new Date(clock())});
   tx.update(recordRef,{accountUid:uid,provisioning:null});
   audit(tx,request,'STUDENT_ACCOUNT_ISSUED',studentId,{recordUid:uid});
   return {token,expiresAt};
  });
 }
 return{
  async studentAnnualPreview(request){
   await admin(request,true);let rows,year;
   try{year=M.academicYear(request.data?.academicYear);rows=M.normalizeRows(request.data?.rows);}catch(e){error('invalid-argument',e.message);}
   if(request.data?.authorized!==true)error('failed-precondition','Confirm this is an authorized SSU-USC student list.');
   const correction=request.data?.correction===true,restoreAccess=request.data?.restoreAccess===true;
   const correctionReason=typeof request.data?.correctionReason==='string'?request.data.correctionReason.trim():'';
   if(correction&&(correctionReason.length<4||correctionReason.length>500))error('invalid-argument','Enter the reason for this academic-year correction (4–500 characters).');
   if(restoreAccess&&!correction)error('failed-precondition','Access restoration requires an explicit correction preview.');
   const entries=[];
   for(let i=0;i<rows.length;i++){
    const row=rows[i];if(row.error){entries.push({line:i+2,error:row.error,studentId:row.studentId});continue;}
    try{
     const current=await resolve(row.studentId);
     const record=await getRecord(row.studentId);
     if(current?.accessRestoreImportId)error('failed-precondition','Resume the pending access restoration before importing this student again.');
     M.nextAcademicProfile(record||current,row,year,{allowOlderYear:correction});
     const restriction=['graduated','dropped'].includes(row.studentStatus),restoreFromImportId=restoreAccess?await restoreSource(current,row):null;
     const entry={line:i+2,row,uid:current?.uid||null,fingerprint:M.fingerprint(current),recordRevision:revision(record),
      action:restriction?(row.studentStatus==='dropped'?(current?'drop-disable-access':'mark-dropped'):(current?'graduate-disable-access':'mark-graduated')):restoreFromImportId?'correct-and-restore-access':correction?'correct-academic-record':record?'update':'record-only',
      ...(restoreFromImportId?{restoreFromImportId,warning:'Will restore this approved import-disabled account. Voting verification and candidacy are not granted.'}:restriction?{warning:current?'Applying this row revokes the linked account’s portal access.':`${row.studentStatus} record; account registration will be blocked.`}:{})};
     try{verifyIdentity(current,record,row);}catch(e){
      entries.push({...entry,error:e.message,...(current&&(!record||record.uid===current.uid)?{reviewName:record?.fullName||current.fullName}: {})});
      continue;
     }
     entries.push(entry);
    }catch(e){entries.push({line:i+2,studentId:row.studentId,error:e.message});}
   }
   const ref=jobs.doc(),hasErrors=entries.some(e=>e.error);
   await ref.set({academicYear:year,entries,createdBy:request.auth.uid,createdAt:clock(),expiresAt:clock()+86400000,status:'records-preview',count:entries.length,correction,correctionReason,restoreAccess});
   return{importId:ref.id,academicYear:year,status:'records-preview',correction,correctionReason,restoreAccess,entries:entries.map(({fingerprint,recordRevision,...e})=>e),hasErrors};
  },
  async studentAnnualApply(request){
   await admin(request,true);const job=await getJob(request.data?.importId);
   if(job.data.status!=='records-preview')error('failed-precondition','Create a new SCL preview before applying this file.');
   if(request.data?.confirmed!==true)error('failed-precondition','Confirm the Ready rows before applying.');
   const expired=clock()>=job.data.expiresAt;
   if(expired&&!(await job.ref.collection('results').limit(1).get()).docs.length)error('failed-precondition','Import preview expired. Create a new preview.');
   const start=request.data?.start;
   if(!Number.isInteger(start)||start<0||start>=job.data.entries.length)error('invalid-argument','Invalid import offset.');
   const results=[];
   for(let i=start;i<Math.min(start+10,job.data.entries.length);i++){
    if(job.data.entries[i].error)continue;
    try{
     if(expired&&!(await job.ref.collection('results').doc(String(i)).get()).exists)error('failed-precondition','Preview expired before this row was saved. Create a new preview for this row.');
     results.push({index:i,...await applyRow(job,job.data.entries[i],i,request)});
    }
    catch(e){results.push({index:i,studentId:job.data.entries[i].row.studentId,state:'failed',message:e.code?.startsWith('auth/')?'Authentication synchronization failed. Check the account and retry.':e.message});}
   }
   return{results,next:start+10<job.data.entries.length?start+10:null};
  },
  async studentAnnualJob(request){
   await admin(request);const job=await getJob(request.data?.importId),results=await job.ref.collection('results').get();
   return{importId:job.ref.id,academicYear:job.data.academicYear,count:job.data.count,status:job.data.status,correction:job.data.correction===true,correctionReason:job.data.correctionReason||'',restoreAccess:job.data.restoreAccess===true,entries:job.data.entries.map(({fingerprint,recordRevision,...e})=>e),results:results.docs.map(d=>({index:Number(d.id),...d.data()}))};
  },
  async studentAnnualResolve(request){
   await admin(request,true);
   const {importId,index,verificationReference}=request.data||{};
   if(request.data?.samePerson!==true||!Number.isInteger(index)||typeof verificationReference!=='string'||verificationReference.trim().length<4||verificationReference.length>240)
    error('invalid-argument','Verify the same person and enter a verification reference.');
   const job=await getJob(importId),entry=job.data.entries[index];
   if(job.data.status!=='records-preview'||clock()>=job.data.expiresAt||!entry?.reviewName||!entry.error||!entry.uid)
    error('failed-precondition','This row needs a new preview or a separate ownership review.');
   const {studentId}=entry.row;
   const profile=await resolve(studentId), record=await getRecord(studentId);
   if(profile?.uid!==entry.uid||M.fingerprint(profile)!==entry.fingerprint||revision(record)!==entry.recordRevision)
    error('failed-precondition','The existing identity changed. Generate a new preview.');
   await db.runTransaction(async tx=>{
    const snapshot=(await tx.get(job.ref)).data(),entries=snapshot.entries.slice();
    if(!entries[index]?.error)return;
    const {error:reason,reviewName,...ready}=entries[index];
    entries[index]={...ready,reconciled:true};
    tx.update(job.ref,{entries});
    audit(tx,request,'SCL_IDENTITY_REVIEWED',studentId,{importId,accountUid:entry.uid,verificationReference:verificationReference.trim()});
   });
   return {verified:true};
  },
  async studentRegistrationLookup(request){
   await admin(request);
   const studentId=validId(request.data?.studentId),account=await resolve(studentId),record=await getRecord(studentId);
   if(record&&account&&record.uid!==account.uid)error('failed-precondition','The masterlist and account ownership conflict.');
   return {record:record?publicProfile(record):null,recordRevision:revision(record),account:account?publicProfile({...account,accountUid:account.uid}):null,
    canReissue:account?.role==='student'&&account.accountStatus==='pending'&&account.activationStatus==='pending'&&account.activationMethod==='in-person'};
  },
  studentRegistrationIssue:registerStudent,
  async studentActivationResend(request){await admin(request,true);return issueActivation(request.data?.studentId,request);},
  async studentActivateAccount(request){
   const{token,password}=request.data||{};
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>128)error('invalid-argument','Use a valid activation link and a password of 12–128 characters.');
   const ref=db.doc(`student_activation_tickets/${hash(token)}`),lease=randomToken();let ticket;
   await db.runTransaction(async tx=>{
    const s=await tx.get(ref);ticket=s.data();
    if(!ticket||ticket.expiresAt<=clock()||ticket.state==='used')error('failed-precondition','Activation link is invalid, expired, or already used. Ask the administrator for a new link.');
    const profile=await tx.get(db.doc(`users/${ticket.uid}`));
    if(profile.data()?.activationStatus!=='pending'||profile.data()?.activationTokenHash!==ref.id||(ticket.verifyMailbox===false?profile.data()?.authEmail:profile.data()?.institutionalEmail)!==ticket.email)error('failed-precondition','Activation link is no longer valid.');
    if(ticket.leaseUntil>clock())error('aborted','Activation is already processing. Please wait a minute before retrying.');
    tx.update(ref,{state:'processing',lease,leaseUntil:clock()+60000});
   });
   const authUser=await adminAuth.getUser(ticket.uid);
   if(authUser.email?.toLowerCase()!==ticket.email||authUser.customClaims?.role!=='student')error('failed-precondition','Account identity requires administrator review.');
   // Ticket possession verifies the imported mailbox. Auth/Firestore finalization
   // is resumable: never consume the ticket before both systems are ready.
   await adminAuth.updateUser(ticket.uid,{password,...(ticket.verifyMailbox===false?{}:{emailVerified:true})});
   await ref.update({state:'auth-pending'});
   const userRef=db.doc(`users/${ticket.uid}`),current=(await userRef.get()).data();
   const active=current?.studentStanding==='active'&&current.accountStatus==='pending';
   try{
    await adminAuth.updateUser(ticket.uid,{disabled:!active});
    await db.runTransaction(async tx=>{
     const[s,p]=await Promise.all([tx.get(ref),tx.get(userRef)]);const profile=p.data();
     if(s.data()?.lease!==lease||profile?.activationTokenHash!==ref.id||profile?.activationStatus!=='pending'||(profile.studentStanding==='active'&&profile.accountStatus==='pending')!==active)error('failed-precondition','Activation state changed. Retry or ask the administrator for a new link.');
     tx.update(userRef,{activationStatus:'complete',institutionalEmailVerified:ticket.verifyMailbox===false?profile.institutionalEmailVerified===true:true,activationCompletedAt:clock(),activationTokenHash:null,accountStatus:profile.accountStatus==='pending'?'approved':profile.accountStatus,isActive:active,standingManagedDisabled:!active});
     tx.set(db.doc(`school_accounts/${ticket.studentId}`),{active,isActive:active},{merge:true});
     tx.set(db.doc(`student_masterlist/${ticket.studentId}`),{eligible:active},{merge:true});
     tx.update(ref,{state:'used',usedAt:clock()});
     tx.set(db.collection('audit_logs').doc(),{actorUid:ticket.uid,action:'STUDENT_ACCOUNT_ACTIVATED',targetStudentId:ticket.studentId,createdAt:new Date(clock())});
    });
   }catch(e){const latest=(await userRef.get()).data();if(latest?.activationStatus!=='complete'||latest.isActive!==true)await adminAuth.updateUser(ticket.uid,{disabled:true}).catch(()=>{});throw e;}

   return{activated:true,canAccess:active};
  },
  async studentRecordsList(request){
   await admin(request);
   const data=request.data||{};
   if(data.studentId){
    const id=validId(data.studentId),record=await getRecord(id),profile=await resolve(id);
    if(record&&profile&&record.uid!==profile.uid)error('failed-precondition','Student ID is linked to a different permanent account. Review the ownership conflict.');
    const student=combine(record,profile);
    return{students:student?[publicProfile(student)]:[],next:null};
   }
   const allowedFilters=['fullName','college','program','yearLevel','academicYear','studentStanding','accountStatus','enrollmentStatus'];
   const filters=Object.entries(data.filters||{});
   if(filters.some(([key,value])=>!allowedFilters.includes(key)||typeof value!=='string'||value.length>160))error('invalid-argument','Invalid student filter.');
   const matches=row=>filters.every(([key,value])=>{
    const term=value.trim().toLowerCase();
    if(!term)return true;
    if(key==='college'&&M.canonicalDepartment(term))return M.canonicalDepartment(row.college)===M.canonicalDepartment(term);
    const valueToMatch=key==='program'?M.canonicalProgram(M.canonicalDepartment(row.college),row.program)||row.program:
     key==='accountStatus'?accountState(row):row[key];
    const actual=String(valueToMatch||'').toLowerCase();
    if(key==='yearLevel'&&/^[1-6]$/.test(term))return actual.startsWith(term);
    return ['fullName','college','program','enrollmentStatus'].includes(key)?actual.includes(term):actual===term;
   });
   let phase='records',after='';
   if(data.after){
    if(typeof data.after!=='string'||!/^(records|legacy):[a-zA-Z0-9_-]{0,128}$/.test(data.after))error('invalid-argument','Invalid cursor.');
    [phase,after]=data.after.split(':');
   }
   let q=phase==='records'?db.collection('student_records'):db.collection('users').where('role','in',['student','officer']);
   q=q.orderBy('__name__').limit(51);
   if(after)q=q.startAfter(after);
   const docs=(await q.get()).docs;
   const rows=await Promise.all(docs.slice(0,50).map(async d=>{
    const row={...d.data(),uid:d.id};
    if(phase==='legacy')return (await db.doc(`student_records/${d.id}`).get()).exists?null:combine(null,row);
    const profile=row.accountUid?(await db.doc(`users/${row.accountUid}`).get()).data():null;
    return combine(row,profile && {...profile,uid:row.accountUid});
   }));
   return{students:rows.filter(row=>row&&matches(row)).map(publicProfile),next:docs.length>50?`${phase}:${docs[49].id}`:phase==='records'?'legacy:':null};
  },
  async studentRecordSetStanding(request){
   await admin(request,true);
   const studentId=validId(request.data?.studentId),standing=request.data?.standing;
   if(!['active','graduated','dropped','inactive','withdrawn'].includes(standing))error('invalid-argument','Choose a valid student status.');
   const record=await getRecord(studentId);
   if(!record)error('not-found','Student record not found.');
   const ref=db.doc(`student_records/${record.uid}`);
   const history=db.doc(`users/${record.uid}`).collection('academic_history').doc();
   await db.runTransaction(async tx=>{
    const [previous,account]=await Promise.all([tx.get(ref),tx.get(db.doc(`users/${record.uid}`))]);
    const saved=previous.data();
    if(!saved||saved.accountUid||account.exists)error('failed-precondition','Manage linked account access in User Directory.');
    if(['pending','issuing'].includes(saved.provisioning))error('failed-precondition','Resume the pending provisioning operation first.');
    if(saved.studentStanding===standing)return;
    const now=clock();
    tx.update(ref,{studentStanding:standing,recordRevision:history.id,updatedAtMs:now});
    tx.create(history,{academicYear:saved.academicYear,before:M.academicSnapshot(saved),after:M.academicSnapshot({...saved,studentStanding:standing}),actorUid:request.auth.uid,recordedAt:now});
    audit(tx,request,'STUDENT_STANDING_CHANGED',studentId,{before:saved.studentStanding,after:standing});
   });
   return{updated:true};
  },
  async studentRecordDetail(request){
   await admin(request);
   const studentId=validId(request.data?.studentId),record=await getRecord(studentId),account=await resolve(studentId);
   if(record&&account&&record.uid!==account.uid)error('failed-precondition','Student ID is linked to a different permanent account. Review the ownership conflict.');
   const profile=combine(record,account);
   if(!profile)error('not-found','Student record not found.');
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
function combine(record,account){
 if(!record&&!account)return null;
 if(!account)return {...record,accountStatus:'pending',isActive:false,activationStatus:'awaiting-provisioning'};
 return {...account,...record,accountUid:account.uid,accountStatus:account.accountStatus,isActive:account.isActive,activationStatus:account.activationStatus,activationDelivery:account.activationDelivery,role:account.role,studentStanding:account.studentStanding||record?.studentStanding||null,enrollmentStatus:record?.enrollmentStatus||account.enrollmentClassification||account.enrollmentStatus};
}
function accountState(p){
 if(p.accountStatus==='suspended')return 'Suspended';
 if(p.activationStatus==='awaiting-provisioning')return 'No account';
 if(p.activationStatus==='pending'||p.accountStatus==='pending')return 'Pending activation';
 return p.isActive?'Active':'Deactivated';
}
function publicProfile(p){return {...Object.fromEntries(['uid','accountUid','studentId','fullName','firstName','lastName','middleName','suffix','enrollmentStatus','college','program','yearLevel','academicYear','studentStanding','accountStatus','isActive','activationStatus','activationDelivery','institutionalEmail','role'].map(k=>[k,p[k]??null])),accountState:accountState(p)};}
module.exports={createStudentRecordHandlers};
