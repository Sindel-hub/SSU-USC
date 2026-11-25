import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';
import {parseStudentCsv,readStudentWorkbook,IMPORT_HEADERS,rowsFromTable,validateWorkbookZip}from'../shared/student-import-file.mjs';
import{SSU_PROGRAMS,formatSsuCollege,formatSsuProgram}from'../usc-admin/student-registration/js/ssu-programs.js';
const require=createRequire(import.meta.url),M=require('../functions/student-records-model'),{fixture}=require('./helpers/student-records-fixture.cjs'),ExcelJS=require('../vendor/exceljs/exceljs-4.4.0.min.js');
const row=(patch={})=>({studentId:'000123',fullName:'Synthetic Student',department:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel:'2',email:'synthetic@example.invalid',status:'active',...patch});
const preview=async(f,rows=[row()],year='2026-2027')=>f.handlers.studentAnnualPreview({...f.admin,data:{rows,academicYear:year,authorized:true}});
const apply=(f,id)=>f.handlers.studentAnnualApply({...f.admin,data:{importId:id,start:0,confirmed:true}});
const lookup=(f,studentId='000123')=>f.handlers.studentRegistrationLookup({...f.admin,data:{studentId}});
const issue=async(f,patch={})=>{
 const studentId=patch.studentId||'000123',record=await lookup(f,studentId);
 return f.handlers.studentRegistrationIssue({...f.admin,data:{studentId,recordRevision:record.recordRevision,verifiedInPerson:true,...patch}});
};
const baseProfile=patch=>({studentId:'000123',fullName:'Synthetic Student',college:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel:'1',academicYear:'2025-2026',studentStanding:'active',enrollmentStatus:'Enrolled',institutionalEmail:'synthetic@example.invalid',email:'synthetic@example.invalid',accountStatus:'approved',isActive:true,role:'student',...patch});
test('CSV accepts the exact template and preserves leading zeros and quoted values', () => {
 const header=IMPORT_HEADERS.join(',');
 const [data]=parseStudentCsv(`\uFEFF${header}\r\n"000123","Student, Jr.","Sample",,,College of Engineering,Bachelor of Science in Civil Engineering,2,Regular,`);
 assert.equal(data.studentId,'000123');
 assert.equal(data.lastName,'Student, Jr.');
 assert.equal(data.email,'');
 for(const invalid of [`${header}\n001,"Unclosed`, 'studentId,fullName\n001,A'])assert.throws(()=>parseStudentCsv(invalid));
 assert.throws(()=>rowsFromTable([IMPORT_HEADERS,...Array(501).fill(['1','A','B','','','D','P','1','Regular',''])]));
});
test('Excel preserves text IDs and rejects numeric IDs and formulas',async()=>{
 async function workbook(id,formula=false){const b=new ExcelJS.Workbook(),s=b.addWorksheet('Students');s.addRow(IMPORT_HEADERS);s.addRow([id,'Student','Synthetic','','',M.DEPARTMENTS[3],'Bachelor of Science in Civil Engineering',formula?{formula:'1+1'}:2,'Regular','']);return b.xlsx.writeBuffer();}
 assert.equal((await readStudentWorkbook(await workbook('000123'),ExcelJS))[0].studentId,'000123');await assert.rejects(readStudentWorkbook(await workbook(123),ExcelJS),/stored as text/);await assert.rejects(readStudentWorkbook(await workbook('000123',true),ExcelJS),/formulas/);assert.throws(()=>validateWorkbookZip(new Uint8Array([1,2,3]).buffer));
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
test('apply saves only Ready rows from a mixed preview and neither creates accounts nor sends email', async () => {
 const f=fixture();
 const p=await preview(f,[row(),row({studentId:'000124',program:'Invalid'}),row({studentId:'000125'}),row({studentId:'000125'})]);
 assert.equal(p.hasErrors,true);
 assert.equal(f.records.has('student_record_ids/000123'),false);
 await assert.rejects(f.handlers.studentAnnualApply({...f.admin,data:{importId:p.importId,start:0}}),{code:'failed-precondition'});
 const result=await apply(f,p.importId);
 assert.deepEqual(result.results.map(row=>row.studentId),['000123']);
 assert.equal(f.authUsers.size,0);
 assert.equal(f.sent.length,0);
 assert.equal(f.records.has('student_record_ids/000124'),false);
 assert.equal(f.records.has('student_record_ids/000125'),false);
 assert.equal((await f.handlers.studentAnnualJob({...f.admin,data:{importId:p.importId}})).entries.filter(row=>row.error).length,3);
 await apply(f,p.importId);
 assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,1);
});

test('office issuance requires a saved record and verified presence, then blocks duplicate accounts', async () => {
 const f=fixture();
 await assert.rejects(issue(f),{code:'failed-precondition'});
 await apply(f,(await preview(f)).importId);
 const {record}=await lookup(f);
 await assert.rejects(issue(f,{verifiedInPerson:false}),{code:'failed-precondition'});
 const {token}=await issue(f);
 assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal(f.records.get('users/'+record.uid).accountStatus,'pending');
 assert.equal(f.authUsers.get(record.uid).disabled,true);
 assert.equal(f.sent.length,0);
 assert.equal((await lookup(f)).account.uid,record.uid);
 await assert.rejects(issue(f),{code:'already-exists'});
});
test('continuing students keep credentials, role, permissions and activity while academic history is appended',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({role:'officer',officerPermissions:['bulletin.manage']}),{password:'Existing-password',customClaims:{role:'officer'}});f.records.set('complaints/old',{studentUid:uid,subject:'Synthetic concern',status:'Submitted'});
 const p=await preview(f),r=await apply(f,p.importId);assert.equal(r.results[0].uid,uid);const user=f.records.get('users/'+uid);assert.equal(user.role,'officer');assert.deepEqual(user.officerPermissions,['bulletin.manage']);assert.equal(f.authUsers.get(uid).password,'Existing-password');assert.equal(f.sent.length,0);assert.ok(f.records.has('complaints/old'));
 const history=[...f.records].find(([k])=>k.includes('/academic_history/'))[1];assert.equal(history.before.academicYear,'2025-2026');assert.equal(history.after.academicYear,'2026-2027');
});
test('imports preserve existing access and leave omitted students unchanged',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),other=f.seed(baseProfile({studentId:'999999',institutionalEmail:'other@example.invalid',email:'other@example.invalid'}));const p=await preview(f,[row({status:'graduated'})]);await apply(f,p.importId);assert.equal(f.records.get('users/'+uid).isActive,true);assert.equal(f.authUsers.get(uid).disabled,false);assert.equal(f.authUsers.get(uid).revoked,undefined);assert.equal(f.records.get('users/'+other).isActive,true);assert.equal(f.authUsers.size,2);
});
test('an active import cannot unsuspend or undo manual account disablement',async()=>{
 for(const patch of [{accountStatus:'suspended',isActive:false},{isActive:false}]){const f=fixture(),uid=f.seed(baseProfile(patch));const p=await preview(f);await apply(f,p.importId);assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.authUsers.get(uid).disabled,false);}
});
test('stale previews and conflicting Student ID ownership fail closed',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),p=await preview(f);f.records.get('users/'+uid).yearLevel='3';const r=await apply(f,p.importId);assert.equal(r.results[0].state,'failed');assert.equal(f.records.get('users/'+uid).yearLevel,'3');
 f.records.set('school_accounts/000123',{uid:'different'});assert.equal((await preview(f)).hasErrors,true);
});
test('office issuance retries preserve UID and history after an Auth failure', async () => {
 const f=fixture();
 const result=await apply(f,(await preview(f)).importId),uid=result.results[0].uid;
 const setClaims=f.adminAuth.setCustomUserClaims;
 f.adminAuth.setCustomUserClaims=async()=>{throw Error('Temporary Auth outage');};
 await assert.rejects(issue(f),/Temporary Auth outage/);
 assert.equal(f.records.get('student_records/'+uid).accountUid,null);
 f.adminAuth.setCustomUserClaims=setClaims;
 await issue(f);
 assert.equal(f.authUsers.size,1);
 assert.equal(f.records.get('student_records/'+uid).accountUid,uid);
 assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,1);
});
test('a student without email can use a single-use in-person link and set their own password', async () => {
 const f=fixture();
 const result=await apply(f,(await preview(f,[row({email:''})])).importId),uid=result.results[0].uid;
 assert.equal(f.authUsers.size,0);
 const {token}=await issue(f);
 assert.equal(f.authUsers.get(uid).email,'000123@student.ssu-usc.local');
 assert.equal(f.records.get('users/'+uid).institutionalEmail,'');
 await assert.rejects(f.handlers.studentActivateAccount({data:{token,password:'short'}}),{code:'invalid-argument'});
 assert.equal((await f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}})).canAccess,true);
 assert.equal(f.authUsers.get(uid).emailVerified,false);
 assert.equal(f.authUsers.get(uid).password,'Student-chosen-password');
 await assert.rejects(f.handlers.studentActivateAccount({data:{token,password:'Different-password-now'}}),{code:'failed-precondition'});
});
test('authorized retries replace in-person tokens and separately sent email still verifies mailbox', async () => {
 const f=fixture();await apply(f,(await preview(f)).importId);
 const first=await issue(f);
 await assert.rejects(issue(f,{reissue:true}),{code:'resource-exhausted'});
 f.advance(61000);
 const replacement=await issue(f,{reissue:true});
 await assert.rejects(f.handlers.studentActivateAccount({data:{token:first.token,password:'Student-chosen-password'}}),{code:'failed-precondition'});
 f.advance(86400001);
 await assert.rejects(f.handlers.studentActivateAccount({data:{token:replacement.token,password:'Student-chosen-password'}}),{code:'failed-precondition'});
 await f.handlers.studentActivationResend({...f.admin,data:{studentId:'000123'}});
 const {token}=f.sent[0];
 await f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}});
 assert.equal(f.authUsers.get((await lookup(f)).account.uid).emailVerified,true);
});
test('verified legacy name review applies the masterlist correction without changing the existing account',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({fullName:'Legacy Name'}),{password:'Original-password'});
 const p=await preview(f);
 assert.equal(p.entries[0].reviewName,'Legacy Name');
 assert.equal((await apply(f,p.importId)).results.length,0);
 await f.handlers.studentAnnualResolve({...f.admin,data:{importId:p.importId,index:0,samePerson:true,verificationReference:'In-person ID checked'}});
 await apply(f,p.importId);
 assert.equal(f.records.get('student_records/'+uid).fullName,'Synthetic Student');
 assert.equal(f.records.get('users/'+uid).fullName,'Legacy Name');
 assert.equal(f.authUsers.get(uid).password,'Original-password');
 await assert.rejects(issue(f),{code:'already-exists'});
});
test('admin monitoring is UID-linked and never returns anonymous survey answers or credentials',async()=>{
 const f=fixture(),uid=f.seed(baseProfile());f.records.set('complaints/one',{studentUid:uid,subject:'Synthetic concern',status:'Submitted'});f.records.set('complaints/two',{studentUid:'other',subject:'Other private concern'});f.records.set('student_signin_stats/'+uid,{signInCount:3,lastSignInAt:f.now});f.records.set('events/fixture/registrations/'+uid,{studentUid:uid,status:'registered',registeredAt:f.now});
 const result=await f.handlers.studentRecordDetail({...f.admin,data:{studentId:'000123'}});assert.equal(result.signins.count,3);assert.equal(result.complaints.length,1);assert.equal(result.participation.length,1);assert.equal(JSON.stringify(result).includes('password'),false);assert.equal(result.surveyResponses,undefined);
});

test('activation retries after Auth enable failure without consuming the token early',async()=>{
 const f=fixture(),p=await preview(f),r=await apply(f,p.importId),uid=r.results[0].uid,{token}=await issue(f);
 f.failNextEnable();await assert.rejects(f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}}));assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.records.get('users/'+uid).activationStatus,'pending');assert.equal(f.authUsers.get(uid).disabled,true);
 f.advance(61000);assert.equal((await f.handlers.studentActivateAccount({data:{token,password:'Student-chosen-password'}})).canAccess,true);assert.equal(f.authUsers.get(uid).disabled,false);
});
test('returning students retain manual and prior access restrictions',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({studentStanding:'graduated',isActive:false,standingManagedDisabled:true}),{disabled:true});
 await apply(f,(await preview(f)).importId);
 assert.equal(f.authUsers.get(uid).disabled,true);
 assert.equal(f.records.get('users/'+uid).studentStanding,'graduated');
});
test('imports respect preview expiry and never restore removed accounts',async()=>{
 const f=fixture(),p=await preview(f);f.advance(86400001);await assert.rejects(apply(f,p.importId),{code:'failed-precondition'});assert.equal(f.authUsers.size,0);
 const g=fixture();g.seed(baseProfile({accountRemoved:true,isActive:false}));assert.equal((await preview(g)).hasErrors,true);
});
test('annual imports preserve existing verification flags',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({isVerifiedStudent:true}));await apply(f,(await preview(f,[row({status:'inactive'})])).importId);assert.equal(f.records.get('users/'+uid).isVerifiedStudent,true);
});
test('a repeated current-year correction preserves both earlier history entries and stable account identity',async()=>{
 const f=fixture(),uid=f.seed(baseProfile());await apply(f,(await preview(f)).importId);await apply(f,(await preview(f,[row({yearLevel:'3'})])).importId);assert.equal(f.authUsers.size,1);assert.equal(f.records.get('student_records/'+uid).yearLevel,'3rd Year');assert.equal(f.records.get('users/'+uid).yearLevel,'3rd Year');assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);
});

test('index source supports private monitoring and exempts bulky preview entries',()=>{
 const indexes=require('../firestore.indexes.json').fieldOverrides;assert.ok(indexes.find(x=>x.collectionGroup==='registrations'&&x.fieldPath==='studentUid').indexes.some(x=>x.queryScope==='COLLECTION_GROUP'&&x.order==='ASCENDING'));assert.deepEqual(indexes.find(x=>x.collectionGroup==='annual_student_imports'&&x.fieldPath==='entries').indexes,[]);
});

test('split fields format a consistent display name and block reused IDs with different names', async () => {
 const f=fixture();
 const {fullName,status,...base}=row();
 const data={...base,firstName:'Roger',middleName:'Elo',lastName:'Crisostomo',suffix:'Jr.',enrollmentStatus:'Regular'};
 const p=await preview(f,[data]), result=await apply(f,p.importId);
 const uid=result.results[0].uid;
 assert.equal(f.records.get('student_records/'+uid).fullName,'Roger E. Crisostomo Jr.');
 await issue(f);
 assert.equal(f.records.get('users/'+uid).middleName,'Elo');
 assert.equal(f.records.get('users/'+uid).enrollmentClassification,'Regular');
 assert.equal((await preview(f,[{...data,firstName:'Someone'}])).hasErrors,true);
});

test('manual status on a record without an account invalidates stale imports and prevents provisioning', async () => {
 const f=fixture();
 await apply(f,(await preview(f,[row({email:''})])).importId);
 const pending=await preview(f);
 await f.handlers.studentRecordSetStanding({...f.admin,data:{studentId:'000123',standing:'withdrawn'}});
 assert.equal((await apply(f,pending.importId)).results[0].state,'failed');
 const current=await preview(f);
 assert.equal((await apply(f,current.importId)).results[0].action,'updated');
 await assert.rejects(issue(f),{code:'failed-precondition'});
 assert.equal(f.authUsers.size,0);
 const found=await f.handlers.studentRecordsList({...f.admin,data:{filters:{studentStanding:'withdrawn',accountStatus:'No account'}}});
 assert.equal(found.students[0].studentId,'000123');
});

test('program aliases and college abbreviations resolve to the supplied official catalog', async () => {
 for (const [department, label, program, expected] of [
   ['College of Arts and Sciences', 'College   of Arts and Sciences (CAS)', 'Bachelor of Information Technology', 'Bachelor of Science in Information Technology'],
   ['College of Arts and Sciences', 'CAS', 'BS-Information   System', 'Bachelor of Science in Information Systems'],
   ['College of Education', 'College of Education (COEd)', 'BSED Major in Science', 'Bachelor of Secondary Education Major in Science'],
   ['College of Industrial Technology', 'College of Industrial Technology (CIT)', 'Electrical Technology', 'Bachelor of Industrial Technology Major in Electrical Technology']
 ]) {
   assert.equal(M.canonicalDepartment(label), department);
   assert.equal(M.canonicalProgram(department, program), expected);
   assert.ok(SSU_PROGRAMS[department].includes(expected));
 }
 assert.equal(formatSsuCollege('College of Arts and Sciences'), 'College of Arts and Sciences (CAS)');
 assert.equal(formatSsuProgram('College of Arts and Sciences', 'Bachelor of Information System'), 'Bachelor of Science in Information Systems');
 const f=fixture();
 const record=row({department:'College of Arts and Sciences (CAS)',program:'Bachelor of Science in Information Technology)'});
 const p=await preview(f,[record]);
 assert.equal(p.hasErrors,false);
 const result=await apply(f,p.importId);
 await issue(f);
 assert.equal(f.records.get('users/'+result.results[0].uid).program,'Bachelor of Science in Information Technology');
 assert.equal((await preview(f,[{...record,department:'COEd'}])).hasErrors,true);
});

test('Student Status is an optional last column in both CSV and Excel',async()=>{
 const old=IMPORT_HEADERS.slice(0,-1),values=['000123','Student','Synthetic','','',M.DEPARTMENTS[3],'Bachelor of Science in Civil Engineering','4','Regular',''];
 assert.equal(parseStudentCsv(old.join(',')+'\n'+values.join(','))[0].studentStatus,undefined);
 assert.equal(parseStudentCsv(IMPORT_HEADERS.join(',')+'\n'+[...values,'Graduated'].join(','))[0].studentStatus,'Graduated');
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Students');sheet.addRow(IMPORT_HEADERS);sheet.addRow([...values,'Undergraduate']);assert.equal((await readStudentWorkbook(await book.xlsx.writeBuffer(),ExcelJS))[0].studentStatus,'Undergraduate');
 assert.ok(M.normalizeRows([row({studentStatus:'unknown'})])[0].error);
});
test('explicit Graduated revokes matched account access and tokens while preserving identity and history',async()=>{
 const f=fixture(),uid=f.seed(baseProfile({isVerifiedStudent:true,candidacyApproved:true})),omitted=f.seed(baseProfile({studentId:'999999',email:'other@example.invalid',institutionalEmail:'other@example.invalid'}));const password=f.authUsers.get(uid).password;
 const p=await preview(f,[row({studentStatus:'Graduated',enrollmentStatus:'Regular'})]);assert.equal(p.entries[0].action,'graduate-disable-access');assert.equal(f.authUsers.get(uid).disabled,false);
 const result=await apply(f,p.importId);assert.equal(result.results[0].state,'complete');const profile=f.records.get('users/'+uid);assert.equal(profile.studentStanding,'graduated');assert.equal(profile.isActive,false);assert.equal(profile.isVerifiedStudent,false);assert.equal(f.authUsers.get(uid).disabled,true);assert.equal(f.authUsers.get(uid).revoked,true);assert.equal(f.authUsers.get(uid).password,password);assert.equal(f.records.get('users/'+omitted).isActive,true);assert.equal(f.records.get('student_records/'+uid).studentStanding,'graduated');
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('users/'+uid+'/academic_history/')).length,1);await apply(f,p.importId);assert.equal([...f.records.keys()].filter(k=>k.startsWith('users/'+uid+'/academic_history/')).length,1);
});
test('Undergraduate, blank and older files never re-enable restricted accounts',async()=>{
 for(const status of ['Undergraduate','',undefined]){const f=fixture(),uid=f.seed(baseProfile({studentStanding:'graduated',isActive:false,accountStatus:'suspended'}),{disabled:true});const r=row();if(status!==undefined)r.studentStatus=status;const p=await preview(f,[r]);await apply(f,p.importId);assert.equal(f.records.get('users/'+uid).studentStanding,'graduated');assert.equal(f.records.get('users/'+uid).accountStatus,'suspended');assert.equal(f.authUsers.get(uid).disabled,true);}
});
test('a new graduated record cannot be issued an account',async()=>{
 const f=fixture(),p=await preview(f,[row({studentStatus:'Graduated'})]);await apply(f,p.importId);assert.equal(f.authUsers.size,0);await assert.rejects(issue(f),{code:'failed-precondition'});
});
test('Auth failure leaves portal blocked and a resumable access journal without duplicate academic changes',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),p=await preview(f,[row({studentStatus:'Graduated'})]);f.failNextAuth();const first=await apply(f,p.importId);assert.equal(first.results[0].state,'failed');assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.records.get('annual_student_imports/'+p.importId+'/results/0').state,'access-pending');f.advance(86400001);const second=await apply(f,p.importId);assert.equal(second.results[0].state,'complete');assert.equal(f.authUsers.get(uid).disabled,true);assert.equal(f.authUsers.get(uid).revoked,true);
});
test('revocation failure is retryable, but manual status changes cannot be overwritten on resume',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),p=await preview(f,[row({studentStatus:'Graduated'})]);const revoke=f.adminAuth.revokeRefreshTokens;f.adminAuth.revokeRefreshTokens=async()=>{throw Error('Revocation unavailable');};assert.equal((await apply(f,p.importId)).results[0].state,'failed');assert.equal(f.authUsers.get(uid).disabled,true);f.adminAuth.revokeRefreshTokens=revoke;assert.equal((await apply(f,p.importId)).results[0].state,'complete');
 const g=fixture(),id=g.seed(baseProfile()),q=await preview(g,[row({studentStatus:'Graduated'})]);g.failNextAuth();await apply(g,q.importId);Object.assign(g.records.get('users/'+id),{studentStanding:'active',isActive:true});assert.match((await apply(g,q.importId)).results[0].message,/state changed/);assert.equal(g.authUsers.get(id).disabled,false);
});

test('concurrent graduation application completes one history entry and one revocation audit',async()=>{
 const f=fixture(),uid=f.seed(baseProfile()),p=await preview(f,[row({studentStatus:'Graduated'})]);const results=await Promise.all([apply(f,p.importId),apply(f,p.importId)]);assert.ok(results.every(r=>r.results[0].state==='complete'));assert.equal([...f.records.keys()].filter(k=>k.startsWith('users/'+uid+'/academic_history/')).length,1);assert.equal([...f.records.values()].filter(r=>r.action==='SCL_GRADUATION_ACCESS_REVOKED').length,1);
});
