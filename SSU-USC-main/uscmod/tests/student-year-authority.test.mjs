import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./helpers/student-records-fixture.cjs');
const M=require('../functions/student-records-model.js');
const row=yearLevel=>({studentId:'000123',fullName:'Synthetic Student',department:M.DEPARTMENTS[3],program:'Bachelor of Science in Civil Engineering',yearLevel,email:'synthetic@example.invalid',status:'active'});
const preview=(f,level='3',year='2026-2027')=>f.handlers.studentAnnualPreview({...f.admin,data:{rows:[row(level)],academicYear:year,authorized:true}});
const apply=(f,id)=>f.handlers.studentAnnualApply({...f.admin,data:{importId:id,start:0,confirmed:true}});
for(const role of ['student','officer'])test('successful import synchronizes year on the same '+role+' identity without changing access, office or credentials',async()=>{
 const f=fixture(),uid=f.seed({uid:'existing',studentId:'000123',fullName:'Synthetic Student',role,yearLevel:'2nd Year',academicYear:'2025-2026',isActive:false,accountStatus:'suspended',studentStanding:'active',officePosition:role==='officer'?'President':'',officerAssignmentId:'kept-term',officerPermissions:['dashboard.view','bulletin.manage'],institutionalEmail:'synthetic@example.invalid'},{password:'Existing-password',disabled:true,customClaims:{role,custom:'keep'}});
 const before=structuredClone(f.records.get('users/'+uid)),authBefore=structuredClone(f.authUsers.get(uid));
 f.records.set('complaints/kept',{studentUid:uid,status:'Submitted'});
 f.records.set('officer_assignments/kept-term',{officerUid:uid,status:'active'});
 const job=await preview(f);assert.equal(f.records.get('users/'+uid).yearLevel,'2nd Year');
 const result=await apply(f,job.importId);assert.equal(result.results[0].state,'complete');
 const after=f.records.get('users/'+uid);assert.equal(after.yearLevel,'3rd Year');assert.equal(after.academicYear,'2026-2027');
 for(const key of Object.keys(before).filter(k=>!['yearLevel','academicYear'].includes(k)))assert.deepEqual(after[key],before[key],key);
 assert.deepEqual(f.authUsers.get(uid),authBefore);assert.equal(f.authUsers.size,1);assert.equal(f.sent.length,0);
 for(const key of ['student_records/'+uid,'student_masterlist/000123','school_accounts/000123'])assert.equal(f.records.get(key).yearLevel,'3rd Year',key);
 assert.ok(f.records.has('complaints/kept'));assert.equal(f.records.get('officer_assignments/kept-term').status,'active');
 await apply(f,job.importId);assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,1);
 const correction=await preview(f,'2');await apply(f,correction.importId);assert.equal(f.records.get('users/'+uid).yearLevel,'2nd Year');
 assert.equal([...f.records.keys()].filter(k=>k.includes('/academic_history/')).length,2);
});
test('record-only imports do not create accounts; lookup returns canonical records despite a stale legacy profile',async()=>{
 const f=fixture();const job=await preview(f,'6');await apply(f,job.importId);assert.equal(f.authUsers.size,0);
 const lookup=()=>f.handlers.studentRegistrationLookup({...f.admin,data:{studentId:'000123'}});
 const record=(await lookup()).record;assert.equal(record.yearLevel,'6th Year');assert.equal(record.accountUid,null);
 f.seed({uid:record.uid,studentId:'000123',fullName:'Synthetic Student',role:'student',yearLevel:'1st Year',accountStatus:'approved',isActive:true});
 const result=await lookup();assert.equal(result.account.yearLevel,'1st Year');assert.equal(result.record.yearLevel,'6th Year');assert.equal(result.record.uid,result.account.uid);
});
function directoryFixture(){
 const source=fs.readFileSync(new URL('../shared/security-client.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function browserAdminUpdateUser('),source.indexOf('\nfunction complaintClassificationFromRecord'));
 const old={uid:'student',studentId:'000123',role:'student',yearLevel:'2nd Year',studentStanding:'active',accountStatus:'approved',isActive:true};
 const records=new Map([['users/student',{...old,yearLevel:'3rd Year'}],['student_masterlist/000123',{studentId:'000123',yearLevel:'3rd Year'}],['elections/current/voterRoster/000123',{studentId:'000123',yearLevel:'3rd Year'}]]),writes=[];
 const context=vm.createContext({auth:{currentUser:{uid:'admin',getIdTokenResult:async()=>({claims:{role:'admin'}})}},db:{},doc:(...p)=>p.filter(v=>typeof v==='string').join('/'),collection:()=> 'audit',
  getDoc:async ref=>({exists:()=>true,data:()=>ref==='users/student'?old:ref==='election_config/current'?{electionId:'current'}:{}}),
  normalizeStudentStanding:s=>s||'active',enrollmentStatusForStanding:()=> 'Enrolled',isActiveStudentStanding:s=>s==='active',serverTimestamp:()=>0,
  writeBatch:()=>({update:(path,data)=>writes.push({path,data}),set:(path,data)=>writes.push({path,data}),commit:async()=>{for(const {path,data}of writes)records.set(path,{...records.get(path),...data});}}),console});
 vm.runInContext(body,context);return{update:context.browserAdminUpdateUser,records,writes};
}
test('directory edits cannot overwrite an import with a stale year in users, masterlist or election roster',async()=>{
 const f=directoryFixture();await f.update({uid:'student',adminNotes:'Reviewed account status'});
 for(const path of ['users/student','student_masterlist/000123','elections/current/voterRoster/000123'])assert.equal(f.records.get(path).yearLevel,'3rd Year',path);
 assert.ok(f.writes.length>0);for(const write of f.writes)assert.equal(Object.hasOwn(write.data,'yearLevel'),false,write.path);
});
test('browser directory API rejects manual academic changes before writing',async()=>{
 const f=directoryFixture();await assert.rejects(f.update({uid:'student',yearLevel:'4th Year'}),/Student Records/);assert.equal(f.writes.length,0);
});
