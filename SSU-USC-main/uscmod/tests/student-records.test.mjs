import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';
import {parseStudentCsv,readStudentWorkbook,rowsFromTable,validateWorkbookZip}from'../shared/student-import-file.mjs';
import{SSU_PROGRAMS}from'../usc-admin/student-registration/js/ssu-programs.js';
const require=createRequire(import.meta.url),M=require('../functions/student-records-model'),{fixture}=require('./helpers/student-records-fixture.cjs'),ExcelJS=require('../vendor/exceljs/exceljs-4.4.0.min.js');
const row=(patch={})=>({studentId:'000123',fullName:'Synthetic Student',department:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel:'2',email:'synthetic@example.invalid',status:'active',...patch});
const preview=async(f,rows=[row()],year='2026-2027')=>f.handlers.studentAnnualPreview({...f.admin,data:{rows,academicYear:year,authorized:true}});
const apply=(f,id)=>f.handlers.studentAnnualApply({...f.admin,data:{importId:id,start:0}});
const baseProfile=patch=>({studentId:'000123',fullName:'Earlier Name',college:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel:'1',academicYear:'2025-2026',studentStanding:'active',enrollmentStatus:'Enrolled',institutionalEmail:'synthetic@example.invalid',email:'synthetic@example.invalid',accountStatus:'approved',isActive:true,role:'student',...patch});
test('CSV preserves IDs, quoted names, multiline fields and BOM; rejects malformed and unknown columns',()=>{
 const data=parseStudentCsv('\uFEFF"studentId",fullName,department,program,yearLevel,email,status\r\n"000123","Student, Sample","College of Engineering","Bachelor of Science in Civil Engineering",2,a@example.invalid,active');assert.equal(data[0].studentId,'000123');assert.equal(data[0].fullName,'Student, Sample');
 assert.equal(parseStudentCsv('studentId,fullName,department,program,yearLevel\n001,"A\nB",D,P,1')[0].fullName,'A\nB');
 for(const bad of ['studentId,fullName,department,program,yearLevel\n001,"Unclosed,D,P,1','studentId,fullName,department,program,yearLevel,password\n1,A,D,P,1,x','studentId,studentId\n1,2'])assert.throws(()=>parseStudentCsv(bad));
 assert.throws(()=>rowsFromTable([['studentId','fullName','department','program','yearLevel'],...Array(501).fill(['1','A','D','P','1'])]));
});
test('real Excel import accepts text IDs, rejects numeric IDs and formulas, even when columns are reordered',async()=>{
 async function workbook(id,formula=false){const b=new ExcelJS.Workbook(),s=b.addWorksheet('Students');s.addRow(['fullName','studentId','department','program','yearLevel','email']);s.addRow(['Synthetic',id,M.DEPARTMENTS[3],'Bachelor of Science in Civil Engineering',formula?{formula:'1+1'}:2,'a@example.invalid']);return b.xlsx.writeBuffer();}
 const bytes=await workbook('000123');assert.equal((await readStudentWorkbook(bytes,ExcelJS))[0].studentId,'000123');await assert.rejects(readStudentWorkbook(await workbook(123),ExcelJS),/stored as text/);await assert.rejects(readStudentWorkbook(await workbook('000123',true),ExcelJS),/formulas/);assert.throws(()=>validateWorkbookZip(new Uint8Array([1,2,3]).buffer));
});
test('schema rejects duplicate IDs, duplicate emails, invalid statuses, invalid years and numeric IDs',()=>{
 assert.deepEqual(M.DEPARTMENTS,Object.keys(SSU_PROGRAMS));assert.deepEqual(require('../functions/student-programs.json'),SSU_PROGRAMS);
 assert.throws(()=>M.academicYear('2026-2028'));assert.ok(M.normalizeRows([row(),row()])[1].error);assert.ok(M.normalizeRows([row(),row({studentId:'000124'})])[1].error);
 for(const patch of [{studentId:123},{studentId:'12-34'},{status:'deleted'},{yearLevel:'0'},{department:'Fake'}])assert.ok(M.normalizeRows([row(patch)])[0].error);
 assert.throws(()=>M.nextAcademicProfile(baseProfile({academicYear:'2027-2028'}),row(),'2026-2027'));assert.throws(()=>M.nextAcademicProfile(baseProfile({role:'admin'}),row(),'2026-2027'));
});
test('all admin endpoints reject officers/students, and writes require recent authentication',async()=>{
 const f=fixture();for(const[name,fn]of Object.entries(f.handlers)){if(name==='studentActivateAccount')continue;await assert.rejects(fn({auth:{token:{role:'officer'},active:true,recent:true},data:{}}),{code:'permission-denied'});}
 await assert.rejects(f.handlers.studentAnnualPreview({...f.admin,auth:{...f.admin.auth,recent:false},data:{}}),{code:'failed-precondition'});
});
test('preview is non-mutating for identities, validates email ownership and blocks bad imports',async()=>{
 const f=fixture();let p=await preview(f,[row(),row()]);assert.equal(p.hasErrors,true);assert.equal(f.authUsers.size,0);assert.equal([...f.records].filter(([k])=>k.startsWith('users/')).length,0);await assert.rejects(apply(f,p.importId),{code:'failed-precondition'});
 p=await preview(f,[row({email:''})]);assert.equal(p.hasErrors,true);p=await preview(f,[row({program:'Unknown'})]);assert.equal(p.hasErrors,true);
 await assert.rejects(f.handlers.studentAnnualPreview({...f.admin,data:{rows:[row()],academicYear:'2026-2027',authorized:false}}),{code:'failed-precondition'});
});
test('new accounts await activation; retries preserve UID and count/history, no plaintext credentials returned',async()=>{
 const f=fixture(),p=await preview(f),result=await apply(f,p.importId);assert.equal(result.results[0].action,'created');assert.equal(f.authUsers.size,1);const uid=result.results[0].uid,user=f.records.get('users/'+uid);
 assert.equal(user.isActive,false);assert.equal(user.accountStatus,'pending');assert.equal(f.authUsers.get(uid).emailVerified,false);assert.equal(f.sent.length,1);assert.equal(JSON.stringify(result).includes('password'),false);assert.equal(JSON.stringify(result).includes(f.sent[0].token),false);
 await apply(f,p.importId);assert.equal(f.authUsers.size,1);assert.equal(f.sent.length,1);assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,1);
});
test('continuing students keep credentials, role, permissions and activity while academic history is appended',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({role:'officer',officerPermissions:['bulletin.manage']}),{password:'Existing-password',customClaims:{role:'officer'}});f.records.set('complaints/old',{studentUid:uid,subject:'Synthetic concern',status:'Submitted'});
 const p=await preview(f),r=await apply(f,p.importId);assert.equal(r.results[0].uid,uid);const user=f.records.get('users/'+uid);assert.equal(user.role,'officer');assert.deepEqual(user.officerPermissions,['bulletin.manage']);assert.equal(f.authUsers.get(uid).password,'Existing-password');assert.equal(f.sent.length,0);assert.ok(f.records.has('complaints/old'));
 const history=[...f.records].find(([k])=>k.includes('/academic_history/'))[1];assert.equal(history.before.academicYear,'2025-2026');assert.equal(history.after.academicYear,'2026-2027');
});
test('inactive/graduated students lose access without deletion; omitted students remain unchanged',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),other=f.seed(baseProfile({studentId:'999999',institutionalEmail:'other@example.invalid',email:'other@example.invalid'}));const p=await preview(f,[row({status:'graduated'})]);await apply(f,p.importId);assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.authUsers.get(uid).disabled,true);assert.equal(f.authUsers.get(uid).revoked,true);assert.equal(f.records.get('users/'+other).isActive,true);assert.equal(f.authUsers.size,2);
});
test('an active import cannot unsuspend or undo manual account disablement',async()=>{
 for(const patch of [{accountStatus:'suspended',isActive:false},{isActive:false}]){const f=fixture(),uid=f.seed(baseProfile(patch));const p=await preview(f);await apply(f,p.importId);assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.authUsers.get(uid).disabled,true);}
});
test('stale previews and conflicting Student ID ownership fail closed',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),p=await preview(f);f.records.get('users/'+uid).yearLevel='3';const r=await apply(f,p.importId);assert.equal(r.results[0].state,'failed');assert.equal(f.records.get('users/'+uid).yearLevel,'3');
 f.records.set('school_accounts/000123',{uid:'different'});assert.equal((await preview(f)).hasErrors,true);
});
test('interrupted Auth synchronization resumes without duplicate accounts or history',async()=>{
 const f=fixture(),p=await preview(f);f.failNextAuth();assert.equal((await apply(f,p.importId)).results[0].state,'failed');assert.equal(f.authUsers.size,1);assert.equal((await apply(f,p.importId)).results[0].state,'complete');assert.equal(f.authUsers.size,1);assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,1);
});
test('activation verifies mailbox, sets student-chosen password, and consumes a single-use token',async()=>{
 const f=fixture(),p=await preview(f),r=await apply(f,p.importId),uid=r.results[0].uid,token=f.sent[0].token;
 await assert.rejects(f.handlers.studentActivateAccount({data:{token,password:'short'}}),{code:'invalid-argument'});
 const result=await f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}});assert.equal(result.canAccess,true);assert.equal(f.authUsers.get(uid).emailVerified,true);assert.equal(f.authUsers.get(uid).password,'Student-chosen-password');assert.equal(f.authUsers.get(uid).disabled,false);assert.equal(f.records.get('users/'+uid).isActive,true);
 await assert.rejects(f.handlers.studentActivateAccount({data:{token,password:'Different-password-now'}}),{code:'failed-precondition'});assert.equal(f.authUsers.get(uid).password,'Student-chosen-password');
});
test('expired and replaced activation tokens reject; mail failure is visible, not falsely sent',async()=>{
 const f=fixture(),p=await preview(f);f.setFailEmail(true);const result=await apply(f,p.importId);assert.equal(result.results[0].emailStatus,'unconfirmed');assert.equal(f.records.get('users/'+result.results[0].uid).activationDelivery,'unconfirmed');f.setFailEmail(false);f.advance(61000);
 await f.handlers.studentActivationResend({...f.admin,data:{studentId:'000123'}});const first=f.sent[0].token;f.advance(61000);await f.handlers.studentActivationResend({...f.admin,data:{studentId:'000123'}});await assert.rejects(f.handlers.studentActivateAccount({data:{token:first,password:'Student-chosen-password'}}),{code:'failed-precondition'});f.advance(86400001);await assert.rejects(f.handlers.studentActivateAccount({data:{token:f.sent[1].token,password:'Student-chosen-password'}}),{code:'failed-precondition'});
});
test('activation of an inactive student preserves the academic access restriction',async()=>{
 const f=fixture(),p=await preview(f,[row({status:'inactive'})]),r=await apply(f,p.importId);const activated=await f.handlers.studentActivateAccount({data:{token:f.sent[0].token,password:'Student-chosen-password'}});assert.equal(activated.canAccess,false);assert.equal(f.authUsers.get(r.results[0].uid).disabled,true);
});
test('admin monitoring is UID-linked and never returns anonymous survey answers or credentials',async()=>{
 const f=fixture(),uid=f.seed(baseProfile());f.records.set('complaints/one',{studentUid:uid,subject:'Synthetic concern',status:'Submitted'});f.records.set('complaints/two',{studentUid:'other',subject:'Other private concern'});f.records.set('student_signin_stats/'+uid,{signInCount:3,lastSignInAt:f.now});f.records.set('events/fixture/registrations/'+uid,{studentUid:uid,status:'registered',registeredAt:f.now});
 const result=await f.handlers.studentRecordDetail({...f.admin,data:{studentId:'000123'}});assert.equal(result.signins.count,3);assert.equal(result.complaints.length,1);assert.equal(result.participation.length,1);assert.equal(JSON.stringify(result).includes('password'),false);assert.equal(result.surveyResponses,undefined);
});

test('activation retries after Auth enable failure without consuming the token early',async()=>{
 const f=fixture(),p=await preview(f),r=await apply(f,p.importId),uid=r.results[0].uid,token=f.sent[0].token;
 f.failNextEnable();await assert.rejects(f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}}));assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.records.get('users/'+uid).activationStatus,'pending');assert.equal(f.authUsers.get(uid).disabled,true);
 f.advance(61000);assert.equal((await f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}})).canAccess,true);assert.equal(f.authUsers.get(uid).disabled,false);
});
test('reactivation is allowed only when academic access was managed by the import service',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({studentStanding:'graduated',isActive:false,standingManagedDisabled:true}),{disabled:true});const p=await preview(f);await apply(f,p.importId);assert.equal(f.authUsers.get(uid).disabled,false);assert.equal(f.records.get('users/'+uid).isActive,true);
 const g=fixture(),other=g.seed(baseProfile(),{disabled:true});await apply(g,(await preview(g)).importId);assert.equal(g.authUsers.get(other).disabled,true);assert.equal(g.records.get('users/'+other).isActive,false);
});

test('imports respect preview expiry and never restore removed accounts',async()=>{
 const f=fixture(),p=await preview(f);f.advance(86400001);await assert.rejects(apply(f,p.importId),{code:'failed-precondition'});assert.equal(f.authUsers.size,0);
 const g=fixture();g.seed(baseProfile({accountRemoved:true,isActive:false}));assert.equal((await preview(g)).hasErrors,true);
});
test('inactive imports clear verification flags to remain compatible with existing account rules',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({isVerifiedStudent:true}));await apply(f,(await preview(f,[row({status:'inactive'})])).importId);assert.equal(f.records.get('users/'+uid).isVerifiedStudent,false);
});
test('a repeated current-year correction preserves both earlier history entries and stable account identity',async()=>{
 const f=fixture(),uid=f.seed(baseProfile());await apply(f,(await preview(f)).importId);await apply(f,(await preview(f,[row({yearLevel:'3'})])).importId);assert.equal(f.authUsers.size,1);assert.equal(f.records.get('users/'+uid).yearLevel,'3rd Year');assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);
});

test('index source supports private monitoring and exempts bulky preview entries',()=>{
 const indexes=require('../firestore.indexes.json').fieldOverrides;assert.ok(indexes.find(x=>x.collectionGroup==='registrations'&&x.fieldPath==='studentUid').indexes.some(x=>x.queryScope==='COLLECTION_GROUP'&&x.order==='ASCENDING'));assert.deepEqual(indexes.find(x=>x.collectionGroup==='annual_student_imports'&&x.fieldPath==='entries').indexes,[]);
});
