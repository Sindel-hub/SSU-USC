import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire}from'node:module';
import{parseStudentCsv,readStudentWorkbook,IMPORT_HEADERS}from'../shared/student-import-file.mjs';
import {normalizeStudentStanding,isActiveStudentStanding}from'../shared/student-standing.js';
const require=createRequire(import.meta.url),M=require('../functions/student-records-model'),{fixture}=require('./helpers/student-records-fixture.cjs');
const row=(patch={})=>({studentId:'000123',fullName:'Synthetic Student',department:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel:'3',email:'synthetic@example.invalid',status:'active',studentStatus:'Undergraduate',...patch});
const preview=(f,rows=[row()],year='2027-2028',options={})=>f.handlers.studentAnnualPreview({...f.admin,data:{rows,academicYear:year,authorized:true,...options}});
const apply=(f,importId)=>f.handlers.studentAnnualApply({...f.admin,data:{importId,start:0,confirmed:true}});
const correction={correction:true,correctionReason:'Undo the synthetic future-year test import'};
function setup(){const f=fixture();const uid=f.seed({uid:'existing-officer',studentId:'000123',fullName:'Synthetic Student',college:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel:'2nd Year',academicYear:'2026-2027',role:'officer',officePosition:'President',officerPermissions:['dashboard.view','bulletin.manage'],officerAssignmentId:'kept',accountStatus:'approved',isActive:true,isVerifiedStudent:true,candidacyApproved:true,studentStanding:'active',institutionalEmail:'synthetic@example.invalid'},{password:'Existing-private-password',customClaims:{role:'officer',keep:true}});return{f,uid};}
async function restrict(f,status='Graduated'){const p=await preview(f,[row({studentStatus:status})]);const result=await apply(f,p.importId);assert.equal(result.results[0].state,'complete');return p;}
test('normal older imports remain blocked; explicit reasoned corrections restore academic year and retain history',async()=>{
 const{f,uid}=setup();const future=await preview(f);await apply(f,future.importId);
 assert.equal((await preview(f,[row()], '2026-2027')).hasErrors,true);
 await assert.rejects(preview(f,[row()],'2026-2027',{correction:true}),{code:'invalid-argument'});
 const p=await preview(f,[row({yearLevel:'2'})],'2026-2027',correction);assert.equal(p.hasErrors,false);assert.equal(f.records.get('users/'+uid).academicYear,'2027-2028');
 await apply(f,p.importId);assert.equal(f.records.get('users/'+uid).academicYear,'2026-2027');assert.equal(f.records.get('users/'+uid).yearLevel,'2nd Year');
 assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);assert.ok([...f.records.values()].some(v=>v.action==='SCL_CORRECTION_APPLIED'));
});
test('academic correction alone never re-enables an import-disabled account',async()=>{
 const{f,uid}=setup();await restrict(f);const p=await preview(f,[row()],'2026-2027',correction);await apply(f,p.importId);
 assert.equal(f.records.get('users/'+uid).academicYear,'2026-2027');assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.authUsers.get(uid).disabled,true);
});
for(const status of ['Graduated','Dropped'])test('explicit recovery of '+status+' keeps the same officer identity and never grants verification/candidacy',async()=>{
 const{f,uid}=setup();const before=structuredClone(f.authUsers.get(uid));const source=await restrict(f,status);
 const p=await preview(f,[row({yearLevel:'2'})],'2026-2027',{...correction,restoreAccess:true});assert.equal(p.hasErrors,false);assert.equal(p.entries[0].action,'correct-and-restore-access');
 assert.equal(f.authUsers.get(uid).disabled,true);const result=await apply(f,p.importId);assert.equal(result.results[0].state,'complete');
 const user=f.records.get('users/'+uid);assert.equal(user.studentStanding,'active');assert.equal(user.isActive,true);assert.equal(user.role,'officer');assert.equal(user.officePosition,'President');assert.equal(user.officerAssignmentId,'kept');
 assert.equal(user.isVerifiedStudent,false);assert.equal(user.candidacyApproved,false);assert.equal(f.authUsers.get(uid).disabled,false);assert.equal(f.authUsers.get(uid).password,before.password);assert.deepEqual(f.authUsers.get(uid).customClaims,before.customClaims);assert.equal(f.authUsers.size,1);
 assert.equal(f.records.get('school_accounts/000123').active,true);assert.equal(f.records.get('student_masterlist/000123').eligible,true);
 await apply(f,p.importId);assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);assert.equal([...f.records.values()].filter(r=>r.action==='SCL_IMPORT_ACCESS_RESTORED').length,1);
 assert.equal(f.records.get('annual_student_imports/'+source.importId+'/results/0').state,'complete');
});
test('blank Student Status does not restore access, even inside an approved recovery correction',async()=>{
 const{f,uid}=setup();await restrict(f);const p=await preview(f,[row({studentStatus:''})],'2026-2027',{...correction,restoreAccess:true});await apply(f,p.importId);assert.equal(f.authUsers.get(uid).disabled,true);assert.equal(f.records.get('users/'+uid).isActive,false);
});
test('suspended, pending-activation, unproven and incomplete-source accounts cannot be auto-restored',async()=>{
 for(const patch of [{accountStatus:'suspended'},{activationStatus:'pending'},{standingManagedDisabled:false},{graduationImportId:'bad',importRestrictionId:'bad'}]){
  const{f,uid}=setup();await restrict(f);Object.assign(f.records.get('users/'+uid),patch);const p=await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true});assert.equal(p.hasErrors,true);assert.equal(f.authUsers.get(uid).disabled,true);
 }
 const{f}=setup();const source=await restrict(f);f.records.get('annual_student_imports/'+source.importId+'/results/0').state='access-pending';assert.equal((await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true})).hasErrors,true);
 await assert.rejects(preview(f,[row()],'2026-2027',{restoreAccess:true}),{code:'failed-precondition'});
});
test('Dropped disables authentication, blocks issuance and leaves omitted accounts untouched',async()=>{
 assert.equal(normalizeStudentStanding('dropped'),'dropped');assert.equal(isActiveStudentStanding('dropped'),false);
 const{f,uid}=setup();const other=f.seed({uid:'other',studentId:'999',role:'student',accountStatus:'approved',isActive:true});const p=await preview(f,[row({studentStatus:'Dropped'})]);assert.equal(p.entries[0].action,'drop-disable-access');await apply(f,p.importId);
 assert.equal(f.authUsers.get(uid).disabled,true);assert.equal(f.authUsers.get(uid).revoked,true);assert.equal(f.records.get('users/'+uid).studentStanding,'dropped');assert.equal(f.records.get('users/'+other).isActive,true);
 const g=fixture(),job=await preview(g,[row({studentStatus:'Dropped'})]);await apply(g,job.importId);const saved=await g.handlers.studentRegistrationLookup({...g.admin,data:{studentId:'000123'}});assert.equal(saved.record.studentStanding,'dropped');await assert.rejects(g.handlers.studentRegistrationIssue({...g.admin,data:{studentId:'000123',recordRevision:saved.recordRevision,verifiedInPerson:true}}),{code:'failed-precondition'});assert.equal(g.authUsers.size,0);
});
test('corrections retain duplicate/name/ownership validation and reject stale previews',async()=>{
 const{f,uid}=setup();await restrict(f);
 assert.equal((await preview(f,[row(),row()],'2026-2027',correction)).hasErrors,true);
 assert.equal((await preview(f,[row({fullName:'Different identity'})],'2026-2027',correction)).hasErrors,true);
 const p=await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true});f.records.get('users/'+uid).accountStatus='suspended';const r=await apply(f,p.importId);assert.equal(r.results[0].state,'failed');assert.equal(f.authUsers.get(uid).disabled,true);
});
test('failed access restoration remains blocked and resumes without duplicate history',async()=>{
 const{f,uid}=setup();await restrict(f);const p=await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true});f.failNextEnable();assert.equal((await apply(f,p.importId)).results[0].state,'failed');assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.authUsers.get(uid).disabled,true);
 assert.equal((await preview(f,[row()],'2026-2027',correction)).hasErrors,true);
 f.advance(86400001);assert.equal((await apply(f,p.importId)).results[0].state,'complete');assert.equal(f.authUsers.get(uid).disabled,false);assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);
});
test('a manual suspension during Auth synchronization prevents access restoration',async()=>{
 const{f,uid}=setup();await restrict(f);const p=await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true});const update=f.adminAuth.updateUser;
 f.adminAuth.updateUser=async(id,patch)=>{const result=await update(id,patch);if(patch.disabled===false)f.records.get('users/'+uid).accountStatus='suspended';return result;};
 assert.equal((await apply(f,p.importId)).results[0].state,'failed');assert.equal(f.records.get('users/'+uid).isActive,false);assert.equal(f.authUsers.get(uid).disabled,true);
});

test('concurrent recovery is idempotent and preserves one correction history and audit entry',async()=>{
 const{f,uid}=setup();await restrict(f);const p=await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true});
 const results=await Promise.all([apply(f,p.importId),apply(f,p.importId)]);assert.ok(results.every(r=>r.results[0].state==='complete'));
 assert.equal(f.authUsers.get(uid).disabled,false);assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);assert.equal([...f.records.values()].filter(r=>r.action==='SCL_IMPORT_ACCESS_RESTORED').length,1);
});
test('session-revocation failure after Auth enable remains blocked until a successful retry',async()=>{
 const{f,uid}=setup();await restrict(f);const p=await preview(f,[row()],'2026-2027',{...correction,restoreAccess:true});const revoke=f.adminAuth.revokeRefreshTokens;f.adminAuth.revokeRefreshTokens=async()=>{throw Error('Synthetic revoke outage');};
 assert.equal((await apply(f,p.importId)).results[0].state,'failed');assert.equal(f.authUsers.get(uid).disabled,true);assert.equal(f.records.get('users/'+uid).isActive,false);
 f.adminAuth.revokeRefreshTokens=revoke;assert.equal((await apply(f,p.importId)).results[0].state,'complete');assert.equal(f.authUsers.get(uid).disabled,false);
});
test('correction privileges require an authenticated administrator with recent sign-in',async()=>{
 const{f}=setup();await restrict(f);f.admin.auth.recent=false;await assert.rejects(preview(f,[row()],'2026-2027',correction),{code:'failed-precondition'});
 f.admin.auth.recent=true;f.admin.auth.token.role='officer';await assert.rejects(preview(f,[row()],'2026-2027',correction),{code:'permission-denied'});
});

test('Dropped uses the existing optional Student Status column in CSV and Excel',async()=>{
 const values=['000123','Student','Synthetic','','',M.DEPARTMENTS[3],'Bachelor of Science in Civil Engineering','3','Regular','synthetic@example.invalid','Dropped'];
 const csv=parseStudentCsv(IMPORT_HEADERS.join(',')+'\n'+values.join(','));assert.equal(M.normalizeRows(csv)[0].studentStatus,'dropped');
 const ExcelJS=require('../vendor/exceljs/exceljs-4.4.0.min.js'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Students');sheet.addRow(IMPORT_HEADERS);sheet.addRow(values);
 const excel=await readStudentWorkbook(await book.xlsx.writeBuffer(),ExcelJS);assert.equal(M.normalizeRows(excel)[0].studentStatus,'dropped');
});
test('recovery supports an already completed legacy graduation import without the new restriction marker',async()=>{
 const{f,uid}=setup();const source=await restrict(f);
 const profile=f.records.get('users/'+uid);delete profile.importRestrictionId;
 profile.yearLevel='2nd Year';profile.academicYear='2026-2027';
 const job=f.records.get('annual_student_imports/'+source.importId);delete job.correction;delete job.restoreAccess;delete job.correctionReason;
 const p=await preview(f,[row({yearLevel:'2'})],'2026-2027',{...correction,restoreAccess:true});assert.equal(p.hasErrors,false);
 assert.equal((await apply(f,p.importId)).results[0].state,'complete');assert.equal(f.authUsers.get(uid).disabled,false);assert.equal(f.records.get('users/'+uid).academicYear,'2026-2027');assert.equal(f.records.get('users/'+uid).officePosition,'President');
});
