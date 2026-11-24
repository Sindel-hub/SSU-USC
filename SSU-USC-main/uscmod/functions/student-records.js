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
 async function applyRow(job,entry,index,request){
  const itemRef=job.ref.collection('results').doc(String(index));
  let result=(await itemRef.get()).data();
  if(result?.state==='complete')return result;
  const {row}=entry,{studentId}=row;
  const recordIndex=db.doc(`student_record_ids/${studentId}`);
  const claimRef=db.doc(`student_id_claims/${studentId}`);
  const accountRef=db.doc(`school_accounts/${studentId}`);
  const masterRef=db.doc(`student_masterlist/${studentId}`);
  const normalizedName=identityName(row.fullName);
  const nameRef=db.doc(`student_name_claims/${hash(normalizedName)}`);
  if(!result){
   const current=await resolve(studentId), saved=await getRecord(studentId);
   verifyIdentity(current,saved,row);
   if(M.fingerprint(current)!==entry.fingerprint || (saved?.recordRevision||saved?.lastAnnualImportId||null)!==(entry.recordRevision||null))error('failed-precondition','Student record changed since preview. Create a new preview.');
   if(current&&row.email){
    const authUser=await adminAuth.getUser(current.uid);
    if(authUser.customClaims?.role==='admin'||![current.institutionalEmail,current.email,authUser.email].filter(Boolean).some(value=>value.toLowerCase()===row.email))error('failed-precondition','Existing email identity changed since preview.');
   }
   const uid=current?.uid||saved?.uid||crypto.randomUUID();
   const userRef=db.doc(`users/${uid}`),recordRef=db.doc(`student_records/${uid}`);
   await db.runTransaction(async tx=>{
    const [user,record,indexSnap,claim,account,item,name]=await Promise.all([tx.get(userRef),tx.get(recordRef),tx.get(recordIndex),tx.get(claimRef),tx.get(accountRef),tx.get(itemRef),tx.get(nameRef)]);
    if(item.exists){result=item.data();return;}
    if([indexSnap,claim,account].some(s=>s.data()?.uid&&s.data().uid!==uid))error('failed-precondition','Student ID ownership changed.');
    const profile=user.exists?{...user.data(),uid}:null;
    const prior=record.data();
    if(M.fingerprint(profile)!==entry.fingerprint||(prior?.recordRevision||prior?.lastAnnualImportId||null)!==(entry.recordRevision||null))error('failed-precondition','Student record changed since preview. Create a new preview.');
    if(prior?.provisioning==='pending' && !profile)error('failed-precondition','Resume the previous import before changing this pending record.');
    const {isActive,studentStanding,...academic}=M.nextAcademicProfile(profile||prior,row,job.data.academicYear);
    Object.assign(academic,Object.fromEntries(['firstName','lastName','middleName','suffix'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])),{enrollmentStatus:row.enrollmentStatus||M.enrollment(row.status)});
    const standing=profile?.studentStanding||prior?.studentStanding||studentStanding;
    const email=profile?.institutionalEmail||(!profile ? row.email || prior?.institutionalEmail || '' : '');
    const provision=!profile&&standing==='active'&&Boolean(email);
    const now=clock();
    if(provision){
     if(name.exists&&name.data().uid!==uid)error('already-exists','Name is already reserved by a different account. Review this identity.');
     if(!name.exists)tx.create(nameRef,{nameKey:nameRef.id,normalizedName,fullName:row.fullName,uid,studentId,accountRole:'student',createdBy:request.auth.uid,createdAt:new Date(now)});
    }
    const recordData={...academic,uid,studentId,role:profile?.role||'student',studentStanding:standing,institutionalEmail:email,accountUid:profile?.uid||null,provisioning:provision?'pending':null,lastAnnualImportId:job.ref.id,recordRevision:job.ref.id,updatedAtMs:now};
    tx.set(recordIndex,{uid});
    tx.set(recordRef,recordData,{merge:true});
    if(profile){
     const {enrollmentStatus,...profileAcademic}=academic;
     tx.update(userRef,{...profileAcademic,enrollmentClassification:enrollmentStatus,studentRecordId:uid,lastAnnualImportId:job.ref.id,academicRevision:(profile.academicRevision||0)+1,updatedAt:new Date(now),updatedAtMs:now});
     if(account.exists)tx.set(accountRef,{...profileAcademic,enrollmentClassification:enrollmentStatus,updatedAt:new Date(now)},{merge:true});
     tx.set(masterRef,{studentId,...profileAcademic,enrollmentClassification:enrollmentStatus,studentRecordId:uid,updatedAt:new Date(now)},{merge:true});
    }
    const before=prior||profile;
    const after=M.academicSnapshot(recordData);
    if(!before||JSON.stringify(M.academicSnapshot(before))!==JSON.stringify(after))tx.set(userRef.collection('academic_history').doc(job.ref.id),{academicYear:job.data.academicYear,before:before?M.academicSnapshot(before):null,after,importId:job.ref.id,actorUid:request.auth.uid,recordedAt:now});
    result={studentId,uid,action:profile?'updated':provision?'created':'record-saved',state:provision?'auth-pending':'complete',emailStatus:!profile&&!email?'awaiting-email':undefined,appliedAt:now};
    if(result.emailStatus===undefined)delete result.emailStatus;
    tx.set(itemRef,result);
    audit(tx,request,profile?'STUDENT_ANNUAL_UPDATED':'STUDENT_RECORD_CREATED',studentId,{academicYear:job.data.academicYear,importId:job.ref.id});
   });
  }
  if(result.state==='complete')return result;
  const {uid}=result,recordRef=db.doc(`student_records/${uid}`),userRef=db.doc(`users/${uid}`);
  const record=(await recordRef.get()).data();
  if(record?.lastAnnualImportId!==job.ref.id||record.provisioning!=='pending'){
   const latest=(await itemRef.get()).data();
   if(latest?.state==='complete')return latest;
   error('failed-precondition','The saved record changed. Check its current provisioning state.');
  }
  const email=record.institutionalEmail;
  const emailAliasRef=db.doc(`login_aliases/email_${hash(email)}`);
  const emailAlias=(await emailAliasRef.get()).data();
  if(emailAlias&&emailAlias.uid!==uid)error('already-exists','Email belongs to another account.');
  let authUser;
  try{authUser=await adminAuth.getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
  if(!authUser){
   try{authUser=await adminAuth.createUser({uid,email,emailVerified:false,password:crypto.randomBytes(32).toString('base64url'),displayName:record.fullName,disabled:true});}
   catch(e){if(e.code!=='auth/uid-already-exists')throw e;authUser=await adminAuth.getUser(uid);}
  }
  if(authUser.email?.toLowerCase()!==email||authUser.disabled!==true||(authUser.customClaims?.role&&authUser.customClaims.role!=='student')){
   const latest=(await itemRef.get()).data();
   if(latest?.state==='complete')return latest;
   error('failed-precondition','Provisioning identity conflict.');
  }
  await adminAuth.setCustomUserClaims(uid,{...authUser.customClaims,role:'student',annualStudentId:studentId});
  let created=false;
  await db.runTransaction(async tx=>{
   created=false;
   const [item,saved,profile,claim,account,alias,linkedEmail]=await Promise.all([tx.get(itemRef),tx.get(recordRef),tx.get(userRef),tx.get(claimRef),tx.get(accountRef),tx.get(db.doc(`login_aliases/id_${studentId}`)),tx.get(emailAliasRef)]);
   if(item.data()?.state==='complete'){result=item.data();return;}
   if(saved.data()?.lastAnnualImportId!==job.ref.id || profile.exists || [claim,account,alias,linkedEmail].some(s=>s.exists&&s.data().uid!==uid))error('failed-precondition','Student ID ownership changed.');
   const {fullName,firstName,lastName,middleName,suffix,college,program,yearLevel,academicYear,studentStanding,enrollmentStatus}=record;
   const names=firstName?{firstName,lastName,middleName,suffix}:{};
   const academic={fullName,...names,college,program,yearLevel,academicYear,studentStanding,enrollmentStatus:M.enrollment(studentStanding),enrollmentClassification:enrollmentStatus};
   tx.create(userRef,{...academic,uid,studentId,studentRecordId:uid,role:'student',accountStatus:'pending',activationStatus:'pending',institutionalEmail:email,email,authEmail:email,institutionalEmailVerified:false,schoolProvisioned:true,isVerifiedStudent:false,isActive:false,createdAt:new Date(clock())});
   tx.set(claimRef,{studentId,uid},{merge:true});
   tx.set(accountRef,{studentId,uid,...academic,institutionalEmail:email,authEmail:email,loginEmail:email,active:false,isActive:false},{merge:true});
   tx.set(masterRef,{studentId,uid,...academic,studentRecordId:uid,eligible:false},{merge:true});
   tx.set(db.doc(`login_aliases/id_${studentId}`),{uid,authEmail:email,kind:'studentId',updatedAt:new Date(clock())});
   tx.update(recordRef,{accountUid:uid,provisioning:null});
   result={...result,state:'complete',completedAt:clock(),emailStatus:'pending'};
   tx.set(itemRef,result);
   created=true;
  });
  if(created){
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
     const current=await resolve(row.studentId);
     const record=await getRecord(row.studentId);
     verifyIdentity(current,record,row);
     M.nextAcademicProfile(current||record,row,year);
     if(record?.provisioning==='pending'&&!current)error('failed-precondition','Resume the previous import before changing this pending record.');
     if(current&&row.email){const authUser=await adminAuth.getUser(current.uid);if(![current.institutionalEmail,current.email,authUser.email].filter(Boolean).map(v=>v.toLowerCase()).includes(row.email))error('failed-precondition','Email changes require a separate verified account change.');}
     if(row.email){
      const alias=(await db.doc(`login_aliases/email_${hash(row.email)}`).get()).data();
      if(alias&&(!alias.uid||![current?.uid,record?.uid].includes(alias.uid)))error('already-exists','Email belongs to another account.');
     }
     if(!current&&row.email){
      const [name,legacy]=await Promise.all([db.doc(`student_name_claims/${hash(identityName(row.fullName))}`).get(),db.collection('users').where('fullName','==',row.fullName).limit(2).get()]);
      if((name.exists&&name.data().uid!==record?.uid)||legacy.docs.some(doc=>doc.id!==record?.uid&&!doc.data().idReservationsReleased))error('already-exists','Name is already linked to a different account. Review this identity.');
      try{const found=await adminAuth.getUserByEmail(row.email);if(found.uid!==record?.uid)error('already-exists','Email already belongs to another account.');}catch(e){if(e.code!=='auth/user-not-found')throw e;}}
     entries.push({line:i+2,row,uid:current?.uid||null,fingerprint:M.fingerprint(current),recordRevision:record?.recordRevision||record?.lastAnnualImportId||null,action:current?'update':row.email&&row.status==='active'?'create':'record-only',warning:current?.accountStatus==='suspended'?'Suspended account will remain blocked.':''});
    }catch(e){entries.push({line:i+2,studentId:row.studentId,error:e.code==='auth/internal-error'?'Account lookup failed. Retry later.':e.message});}
   }
   const ref=jobs.doc(),hasErrors=entries.some(e=>e.error);
   await ref.set({academicYear:year,entries,createdBy:request.auth.uid,createdAt:clock(),expiresAt:clock()+86400000,status:hasErrors?'invalid':'reviewed',count:entries.length});
   return{importId:ref.id,academicYear:year,entries:entries.map(({fingerprint,recordRevision,...e})=>e),hasErrors};
  },
  async studentAnnualApply(request){
   await admin(request,true);const job=await getJob(request.data?.importId);
   if(job.data.status!=='reviewed')error('failed-precondition','Import preview is invalid. Create a new preview.');
   const expired=clock()>=job.data.expiresAt;
   if(expired&&!(await job.ref.collection('results').limit(1).get()).docs.length)error('failed-precondition','Import preview expired. Create a new preview.');
   const start=request.data?.start;
   if(!Number.isInteger(start)||start<0||start>=job.data.entries.length)error('invalid-argument','Invalid import offset.');
   const results=[];
   for(let i=start;i<Math.min(start+10,job.data.entries.length);i++){
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
   return{importId:job.ref.id,academicYear:job.data.academicYear,count:job.data.count,status:job.data.status,entries:job.data.entries.map(({fingerprint,recordRevision,...e})=>e),results:results.docs.map(d=>({index:Number(d.id),...d.data()}))};
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
    if(phase==='legacy')return row.studentRecordId?null:combine(null,row);
    const profile=row.accountUid?(await db.doc(`users/${row.accountUid}`).get()).data():null;
    return combine(row,profile && {...profile,uid:row.accountUid});
   }));
   return{students:rows.filter(row=>row&&matches(row)).map(publicProfile),next:docs.length>50?`${phase}:${docs[49].id}`:phase==='records'?'legacy:':null};
  },
  async studentRecordSetStanding(request){
   await admin(request,true);
   const studentId=validId(request.data?.studentId),standing=request.data?.standing;
   if(!['active','graduated','inactive','withdrawn'].includes(standing))error('invalid-argument','Choose a valid student status.');
   const record=await getRecord(studentId);
   if(!record)error('not-found','Student record not found.');
   const ref=db.doc(`student_records/${record.uid}`);
   const history=db.doc(`users/${record.uid}`).collection('academic_history').doc();
   await db.runTransaction(async tx=>{
    const [previous,account]=await Promise.all([tx.get(ref),tx.get(db.doc(`users/${record.uid}`))]);
    const saved=previous.data();
    if(!saved||saved.accountUid||account.exists)error('failed-precondition','Manage linked account access in User Directory.');
    if(saved.provisioning==='pending')error('failed-precondition','Resume the pending provisioning operation first.');
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
 return {...record,...account,accountUid:account.uid,studentStanding:account.studentStanding||record?.studentStanding||null,enrollmentStatus:account.enrollmentClassification||record?.enrollmentStatus||account.enrollmentStatus};
}
function accountState(p){
 if(p.accountStatus==='suspended')return 'Suspended';
 if(p.activationStatus==='pending'||p.activationStatus==='awaiting-provisioning'||p.accountStatus==='pending')return 'Pending activation';
 return p.isActive?'Active':'Deactivated';
}
function publicProfile(p){return {...Object.fromEntries(['uid','accountUid','studentId','fullName','firstName','lastName','middleName','suffix','enrollmentStatus','college','program','yearLevel','academicYear','studentStanding','accountStatus','isActive','activationStatus','activationDelivery','institutionalEmail','role'].map(k=>[k,p[k]??null])),accountState:accountState(p)};}
module.exports={createStudentRecordHandlers};
