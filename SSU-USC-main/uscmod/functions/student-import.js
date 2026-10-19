'use strict';
const crypto = require('node:crypto');
const programs = require('./ssu-programs.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeName = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const normalizeId = value => String(value ?? '').trim().replace(/[\s-]/g, '');
const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
function validateRow(input) {
  if (!input || typeof input !== 'object') return { error: 'Invalid row.' };
  const row = {};
  for (const [key, max] of Object.entries({fullName:120, studentId:30, institutionalEmail:200, college:160, program:160, yearLevel:40})) {
    row[key] = String(input[key] ?? '').trim();
    if (row[key].length > max) return { error: `${key} is too long.` };
  }
  row.studentId = normalizeId(row.studentId);
  row.institutionalEmail = normalizeEmail(row.institutionalEmail);
  if (!/^\d{6}$/.test(row.studentId)) return { error: 'Student ID must contain exactly 6 digits.' };
  if (row.fullName.length < 2 || !normalizeName(row.fullName)) return { error: 'Enter the student’s full name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.institutionalEmail)) return { error: 'Enter a valid institutional email address.' };
  // Match the manual registration catalog; never silently invent a program.
  const college = Object.keys(programs).find(c => c.toLowerCase() === row.college.toLowerCase());
  if (!college) return { error: 'Select a college/campus from the registration catalog.' };
  const program = programs[college].find(p => p.toLowerCase() === row.program.toLowerCase());
  if (!program) return { error: 'Program does not belong to the selected college/campus.' };
  const year = row.yearLevel.match(/^([1-5])(?:(?:st|nd|rd|th)?\s*(?:year)?)?$/i)?.[1];
  if (!year) return { error: 'Year level must be 1st–5th Year.' };
  row.college = college; row.program = program;
  row.yearLevel = ['1st Year','2nd Year','3rd Year','4th Year','5th Year'][Number(year)-1];
  return { row };
}
function createStudentImportService({db, adminAuth, FieldValue, HttpsError, requireActiveRole, requireRecentAuth, generateTemporaryPassword, auditData}) {
  const ts = () => FieldValue.serverTimestamp();
  async function authorize(request) { await requireActiveRole(request, ['admin']); requireRecentAuth(request); }
  // Legacy browser-created records may have no canonical claims. Normalize their
  // identities in pages before preview/creation; all new writes also use locks.
  async function existingIdentities() {
    const ids = new Set(), emails = new Set(), names = new Set();
    for (const collection of ['users','student_masterlist','school_accounts']) {
      let last;
      do {
        let query = db.collection(collection).orderBy('__name__').limit(500).select('studentId','email','institutionalEmail','authEmail','fullName');
        if (last) query = query.startAfter(last);
        const page = await query.get();
        for (const doc of page.docs) {
          const data = doc.data();
          if (data.studentId) ids.add(normalizeId(data.studentId));
          else if (collection !== 'users') ids.add(normalizeId(doc.id));
          for (const key of ['email','institutionalEmail','authEmail']) if (data[key]) emails.add(normalizeEmail(data[key]));
          if (data.fullName) names.add(normalizeName(String(data.fullName)));
        }
        last = page.size === 500 ? page.docs.at(-1) : null;
      } while(last);
    }
    return {ids, emails, names};
  }
  const refsFor = row => [
    db.doc(`student_id_claims/${row.studentId}`),
    db.doc(`student_name_claims/${hash(normalizeName(row.fullName))}`),
    db.doc(`student_import_email_claims/${hash(row.institutionalEmail)}`),
    db.doc(`school_accounts/${row.studentId}`), db.doc(`student_masterlist/${row.studentId}`),
    db.doc(`login_aliases/id_${row.studentId}`), db.doc(`login_aliases/email_${hash(row.institutionalEmail)}`)
  ];
  async function duplicate(row, identities) {
    if (identities.ids.has(row.studentId) || identities.emails.has(row.institutionalEmail) || identities.names.has(normalizeName(row.fullName))) return true;
    const docs = await db.getAll(...refsFor(row));
    if (docs.some(s => s.exists)) return true;
    try { await adminAuth.getUserByEmail(row.institutionalEmail); return true; }
    catch(error) { if (error.code !== 'auth/user-not-found') throw error; }
    return false;
  }
  function rowsOf(request) {
    const rows = request.data?.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 25 || JSON.stringify(rows).length > 100000) throw new HttpsError('invalid-argument','Send 1–25 records per batch.');
    return rows;
  }
  const addIdentity = (sets, row) => { sets.ids.add(row.studentId); sets.emails.add(row.institutionalEmail); sets.names.add(normalizeName(row.fullName)); };
  async function preview(request) {
    await authorize(request);
    const inputs = rowsOf(request), identities = await existingIdentities(), seen = {ids:new Set(),emails:new Set(),names:new Set()}, results=[];
    for (const [index, input] of inputs.entries()) {
      const {row,error} = validateRow(input);
      if (error) { results.push({index,status:'invalid',message:error}); continue; }
      if (seen.ids.has(row.studentId) || seen.emails.has(row.institutionalEmail) || seen.names.has(normalizeName(row.fullName))) { results.push({index,row,status:'duplicate',message:'Duplicate record in this batch.'}); continue; }
      addIdentity(seen,row);
      try { results.push({index,row,status:await duplicate(row,identities)?'existing':'ready',message:''}); }
      catch { throw new HttpsError('unavailable','Existing accounts could not be checked. No accounts were created. Retry the preview.'); }
    }
    return {results};
  }
  async function createOne(row, request, identities) {
    if (await duplicate(row, identities)) return {status:'existing',message:'Existing account or reserved identity; unchanged.'};
    const uid = `import-${crypto.randomUUID()}`, operationId = crypto.randomUUID();
    const refs = refsFor(row);
    const pointer = await db.doc('election_config/current').get();
    const electionId = pointer.exists ? String(pointer.get('electionId') || '') : '';
    if (electionId && /^[^/]{1,160}$/.test(electionId)) refs.push(db.doc(`elections/${electionId}/voterRoster/${row.studentId}`));
    const userRef = db.doc(`users/${uid}`), passwordCheckRef=db.doc(`student_import_password_checks/${uid}`);
    const marker = {uid, bulkImportOperationId:operationId, createdBy:request.auth.uid, updatedAt:ts()};
    let reserved=false;
    try {
      await db.runTransaction(async tx => {
        const docs = await tx.getAll(...refs);
        if (docs.some(s=>s.exists)) throw Object.assign(new Error('Duplicate'),{duplicate:true});
        for (const ref of refs.slice(0,3)) tx.create(ref,{...marker,importReservation:true});
      });
      reserved=true;
      const temporaryPassword = 'U' + generateTemporaryPassword();
      const salt=crypto.randomBytes(16).toString('hex');
      const digest=crypto.scryptSync(temporaryPassword,salt,32).toString('hex');
      await adminAuth.createUser({uid,email:row.institutionalEmail,displayName:row.fullName,password:temporaryPassword,emailVerified:true,disabled:true});
      await adminAuth.setCustomUserClaims(uid,{role:'student',verifiedStudent:false,mustChangePassword:true});
      const now=ts();
      const common={...row,...marker,createdAt:now,updatedAt:now,studentStanding:'active',enrollmentStatus:'Enrolled'};
      // Auth starts disabled. All profile, directory, login and claim records are
      // committed atomically before enabling it or returning its password.
      await db.runTransaction(async tx => {
        const docs = await tx.getAll(...refs, userRef, passwordCheckRef);
        if (docs.slice(0,3).some(s=>s.get('bulkImportOperationId')!==operationId) || docs.slice(3).some(s=>s.exists)) throw new Error('Ownership changed');
        tx.create(passwordCheckRef,{...marker,salt,digest});
        tx.create(userRef,{...common,email:row.institutionalEmail,authEmail:row.institutionalEmail,role:'student',accountStatus:'approved',isActive:true,schoolProvisioned:true,isVerifiedStudent:true,candidacyApproved:false,mustChangePassword:true,verificationState:'school_provisioned_eligible',updatedAtMs:Date.now()});
        tx.set(refs[0],{...common,authEmail:row.institutionalEmail});
        tx.set(refs[1],{...common,nameKey:refs[1].id,normalizedName:normalizeName(row.fullName),accountRole:'student'});
        tx.set(refs[2],{...marker});
        tx.create(refs[3],{...common,authEmail:row.institutionalEmail,loginEmail:row.institutionalEmail,active:true,isActive:true});
        tx.create(refs[4],{...common,eligible:true,verificationMethod:'school_admin_import',verifiedBy:request.auth.uid,verifiedAt:now});
        tx.create(refs[5],{...marker,authEmail:row.institutionalEmail,kind:'studentId'});
        tx.create(refs[6],{...marker,authEmail:row.institutionalEmail,kind:'institutionalEmail'});
        if (refs[7]) tx.create(refs[7],{...common,eligible:true,verificationMethod:'school_admin_import',verifiedBy:request.auth.uid,verifiedAt:now});
        tx.create(db.collection('audit_logs').doc(),auditData({auth:request.auth},'STUDENT_ACCOUNT_IMPORT_PREPARED',userRef.path,null,{created:true},{operationId}));
      });
      await adminAuth.updateUser(uid,{disabled:false});
      let warning='';
      try { await db.collection('audit_logs').add(auditData({auth:request.auth},'STUDENT_ACCOUNT_IMPORTED',userRef.path,null,{created:true},{operationId})); }
      catch { warning=' Account created; completion audit could not be recorded.'; }
      addIdentity(identities,row);
      return {status:'created',message:'Account created.'+warning,uid,temporaryPassword};
    } catch(error) {
      if (error.duplicate) return {status:'existing',message:'Another request reserved this identity; unchanged.'};
      if (!reserved) return {status:'failed',message:'Identity reservation failed. Retry after checking the service.'};
      // Only delete the UID generated by this operation. Never touch an existing
      // user's account or release locks until Auth deletion is confirmed.
      let deleted=error.code==='auth/uid-already-exists';
      try { if(!deleted) await adminAuth.deleteUser(uid); deleted=true; }
      catch(cleanupError) { deleted=cleanupError.code==='auth/user-not-found'; }
      if (deleted) {
        try {
          await db.runTransaction(async tx => {
            const docs = await tx.getAll(...refs,userRef,passwordCheckRef);
            for (const doc of docs) if(doc.exists && doc.get('bulkImportOperationId')===operationId) tx.delete(doc.ref);
          });
          if(error.code==='auth/email-already-exists') return {status:'existing',message:'An Authentication account already uses this email; unchanged.'};
          return {status:'failed',message:'Creation failed; the new account was rolled back. Retry this record.'};
        } catch {}
      }
      try { await adminAuth.updateUser(uid,{disabled:true}); } catch {}
      return {status:'failed',message:'Creation could not be finalized. Identity remains reserved; contact a maintainer for cleanup.',operationId};
    }
  }
  async function create(request) {
    await authorize(request);
    const inputs=rowsOf(request), identities=await existingIdentities(), results=[];
    // Sequential processing controls Authentication/Firestore rate pressure.
    for(const [index,input] of inputs.entries()) {
      const {row,error}=validateRow(input);
      if(error) { results.push({index,status:'invalid',message:error}); continue; }
      try { results.push({index,row,...await createOne(row,request,identities)}); }
      catch { results.push({index,row,status:'failed',message:'Account checks failed; retry after checking service availability.'}); }
    }
    return {results};
  }
  async function completePasswordChange(request) {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated','Sign in first.');
    requireRecentAuth(request, 10*60);
    const uid=request.auth.uid, ref=db.doc(`users/${uid}`), profile=await ref.get();
    const user=await adminAuth.getUser(uid);
    if (!profile.exists || profile.get('role')!=='student' || profile.get('accountStatus')!=='approved' || profile.get('isActive')!==true || !profile.get('bulkImportOperationId') || user.disabled) throw new HttpsError('permission-denied','An active imported student account is required.');
    if (profile.get('mustChangePassword')!==true && user.customClaims?.mustChangePassword!==true) throw new HttpsError('failed-precondition','The initial password has already been changed. Use Profile to change it again.');
    const password=request.data?.password;
    if(typeof password!=='string' || password.length<10 || password.length>64 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) throw new HttpsError('invalid-argument','Use 10–64 characters with uppercase, lowercase, a number and a symbol.');
    const checkRef=db.doc(`student_import_password_checks/${uid}`), check=await checkRef.get();
    if (check.exists && crypto.timingSafeEqual(crypto.scryptSync(password,check.get('salt'),32),Buffer.from(check.get('digest'),'hex'))) throw new HttpsError('invalid-argument','Choose a password different from your temporary password.');
    try {
      await adminAuth.updateUser(uid,{password});
      const batch=db.batch();
      batch.update(ref,{mustChangePassword:false,initialPasswordChangedAt:ts(),updatedAt:ts()});
      batch.delete(checkRef);
      batch.create(db.collection('audit_logs').doc(),auditData({auth:request.auth},'IMPORTED_STUDENT_PASSWORD_CHANGED',ref.path,null,{changed:true}));
      await batch.commit();
      await adminAuth.setCustomUserClaims(uid,{...user.customClaims,mustChangePassword:false,verifiedStudent:profile.get('isVerifiedStudent')===true});
      await adminAuth.revokeRefreshTokens(uid);
    } catch { throw new HttpsError('unavailable','The password change could not be finalized. Sign in again with your new password and retry if prompted.'); }
    return {changed:true};
  }
  return {preview,create,completePasswordChange};
}
module.exports={createStudentImportService,validateRow,normalizeId,normalizeEmail,normalizeName};
