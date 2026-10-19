import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createStudentImportService,productionDependencies,validRow} from './student-import-test-helpers.mjs';
assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST,'Use only the Auth and Firestore emulators.');
const projectId='demo-ssu-student-import',app=initializeApp({projectId},'student-import-tests'),auth=getAuth(app),db=getFirestore(app);
const deps=productionDependencies(db,auth,FieldValue),service=createStudentImportService(deps);
let request;
async function signIn(email,password){const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});return {ok:response.ok,data:await response.json()};}
before(async()=>{await auth.createUser({uid:'admin',email:'admin@example.edu',emailVerified:true,password:'AdminOnly#123'});await auth.setCustomUserClaims('admin',{role:'admin'});await db.doc('users/admin').set({role:'admin',accountStatus:'approved',isActive:true});const login=await signIn('admin@example.edu','AdminOnly#123');const token=await auth.verifyIdToken(login.data.idToken);request={auth:{uid:'admin',token}};await db.doc('election_config/current').set({electionId:'current'});});
after(async()=>{await db.terminate();await deleteApp(app);});
const withRows=(rows,extra={})=>({...request,...extra,data:{rows}});
test('preview has no writes; import creates real login accounts, aliases, roster and no plaintext credentials in Firestore',async()=>{
 const input={...validRow(123456),role:"admin",mustChangePassword:false};const preview=await service.preview(withRows([input,{...input}, {...validRow(123457),studentId:'bad'}]));assert.deepEqual(preview.results.map(r=>r.status),['ready','duplicate','invalid']);assert.equal((await db.collection('student_id_claims').get()).size,0);
 const response=await service.create(withRows([input,input]));const [created,existing]=response.results;assert.equal(created.status,'created');assert.equal(existing.status,'existing');assert.equal(existing.temporaryPassword,undefined);
 const password=created.temporaryPassword;assert.ok(password.length>=14);const login=await signIn(input.institutionalEmail,password);assert.equal(login.ok,true);const token=await auth.verifyIdToken(login.data.idToken);assert.equal(token.mustChangePassword,true);assert.equal(token.role,'student');assert.equal(token.verifiedStudent,false);
 assert.equal((await db.doc('login_aliases/id_123456').get()).get('authEmail'),input.institutionalEmail);assert.equal((await db.doc('elections/current/voterRoster/123456').get()).get('eligible'),true);
 for(const collection of ['users','audit_logs','school_accounts','student_masterlist','student_id_claims','student_name_claims','student_import_email_claims','student_import_password_checks','login_aliases']){const snap=await db.collection(collection).get();assert.ok(!JSON.stringify(snap.docs.map(s=>s.data())).includes(password),collection);}
 const profile=await db.doc(`users/${created.uid}`).get();assert.equal(profile.get('mustChangePassword'),true);
 assert.throws(()=>deps.requireAuth({auth:{uid:created.uid,token}}),/temporary password/);
 await assert.rejects(service.completePasswordChange({auth:{uid:created.uid,token},data:{password}}),/different/);
 const chosen='MyOwnPassword#987';await service.completePasswordChange({auth:{uid:created.uid,token},data:{password:chosen}});assert.equal((await signIn(input.institutionalEmail,password)).ok,false);const changed=await signIn(input.institutionalEmail,chosen);assert.equal(changed.ok,true);assert.equal((await auth.verifyIdToken(changed.data.idToken)).mustChangePassword,false);assert.equal((await auth.verifyIdToken(changed.data.idToken)).verifiedStudent,true);assert.equal((await db.doc(`users/${created.uid}`).get()).get('mustChangePassword'),false);assert.equal((await db.doc(`student_import_password_checks/${created.uid}`).get()).exists,false);
});
test('existing Authentication and normalized legacy Firestore identities are skipped without modification',async()=>{
 const authOnly=validRow(234561);await auth.createUser({uid:'auth-only',email:authOnly.institutionalEmail,password:'KeepOriginal#123',disabled:true});const legacy=validRow(234562);await db.doc('users/legacy').set({...legacy,studentId:'234-562',institutionalEmail:'  MIXED@EXAMPLE.EDU ',role:'officer',accountStatus:'suspended'});const before=(await db.doc('users/legacy').get()).data();
 const records=[authOnly,validRow(234562),{...validRow(234563),institutionalEmail:'mixed@example.edu'}];const preview=await service.preview(withRows(records));assert.ok(preview.results.every(r=>r.status==='existing'));const response=await service.create(withRows(records));assert.ok(response.results.every(r=>r.status==='existing'&&!r.temporaryPassword));assert.equal((await auth.getUser('auth-only')).disabled,true);assert.deepEqual((await db.doc('users/legacy').get()).data(),before);
});
test('concurrent imports cannot create two accounts for one ID or one normalized email',async()=>{
 for(const same of ['studentId','institutionalEmail']){const a=validRow(same==='studentId'?345671:345673),b=validRow(same==='studentId'?345672:345674);b[same]=a[same];const responses=await Promise.all([service.create(withRows([a])),service.create(withRows([b]))]);const results=responses.flatMap(r=>r.results);assert.equal(results.filter(r=>r.status==='created').length,1);assert.equal(results.filter(r=>r.status==='existing').length,1);}
});
test('every preview and creation rechecks administrator permissions and session age',async()=>{
 for(const overrides of [{auth:null},{auth:{uid:'admin',token:{...request.auth.token,role:'officer'}}},{auth:{uid:'admin',token:{...request.auth.token,email_verified:false}}},{auth:{uid:'admin',token:{...request.auth.token,auth_time:1}}}]){for(const handler of [service.preview,service.create])await assert.rejects(handler(withRows([validRow(456781)],overrides)));}
 await db.doc('users/admin').update({isActive:false});await assert.rejects(service.create(withRows([validRow(456781)])));await db.doc('users/admin').update({isActive:true});
 await assert.rejects(service.create(withRows(Array.from({length:26},()=>validRow()))),/1–25/);
});
test('failed activation rolls back only new records; cleanup failure keeps the identity locked and no credentials are returned',async()=>{
 const faultAuth={getUserByEmail:(...args)=>auth.getUserByEmail(...args),createUser:(...args)=>auth.createUser(...args),setCustomUserClaims:(...args)=>auth.setCustomUserClaims(...args),deleteUser:(...args)=>auth.deleteUser(...args),updateUser:async()=>{throw Error('Injected activation failure');}};
 const faulty=createStudentImportService({...deps,adminAuth:faultAuth});const row=validRow(567891),response=await faulty.create(withRows([row]));assert.equal(response.results[0].status,'failed');assert.equal(response.results[0].temporaryPassword,undefined);assert.equal((await db.doc('student_id_claims/567891').get()).exists,false);assert.equal((await db.doc('school_accounts/567891').get()).exists,false);await assert.rejects(auth.getUserByEmail(row.institutionalEmail),e=>e.code==='auth/user-not-found');
 const blocked=validRow(567892),locked=createStudentImportService({...deps,adminAuth:{...faultAuth,deleteUser:async()=>{throw Error('Injected rollback failure');}}});const result=await locked.create(withRows([blocked]));assert.equal(result.results[0].status,'failed');assert.match(result.results[0].message,/reserved/);const user=await auth.getUserByEmail(blocked.institutionalEmail);assert.equal(user.disabled,true);assert.equal((await service.create(withRows([blocked]))).results[0].status,'existing');
 const retry=await service.create(withRows([row]));assert.equal(retry.results[0].status,'created');
});
test('partial failures are isolated and generated passwords differ for every created student',async()=>{
 const inputs=[validRow(678901),{...validRow(678902),yearLevel:'invalid'},validRow(678903)],response=await service.create(withRows(inputs));assert.deepEqual(response.results.map(r=>r.status),['created','invalid','created']);assert.notEqual(response.results[0].temporaryPassword,response.results[2].temporaryPassword);
 const second=await service.create(withRows(inputs));assert.deepEqual(second.results.map(r=>r.status),['existing','invalid','existing']);assert.ok(second.results.every(r=>!r.temporaryPassword));
});
test('an Auth email race is skipped without deleting or resetting the account created by another writer',async()=>{
 const row=validRow(789012);let racingUid;
 const racingAuth={getUserByEmail:(...args)=>auth.getUserByEmail(...args),createUser:async input=>{const existing=await auth.createUser({email:input.email,password:'ExistingWriter#123'});racingUid=existing.uid;return auth.createUser(input);},setCustomUserClaims:(...args)=>auth.setCustomUserClaims(...args),deleteUser:(...args)=>auth.deleteUser(...args),updateUser:(...args)=>auth.updateUser(...args)};
 const racing=createStudentImportService({...deps,adminAuth:racingAuth});const result=await racing.create(withRows([row]));assert.equal(result.results[0].status,'existing');assert.equal(result.results[0].temporaryPassword,undefined);assert.equal((await auth.getUser(racingUid)).disabled,false);assert.equal((await signIn(row.institutionalEmail,'ExistingWriter#123')).ok,true);assert.equal((await db.doc('student_id_claims/789012').get()).exists,false);
});
