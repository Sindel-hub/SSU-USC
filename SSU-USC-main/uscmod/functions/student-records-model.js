"use strict";
const {createHash}=require('node:crypto');
const STATUSES=Object.freeze(['active','leave','inactive','graduated','transferred','withdrawn','eliminated']);
const PROGRAMS = require('./student-programs.json');
const DEPARTMENTS = Object.freeze(Object.keys(PROGRAMS));
const abbreviations = {
 'College of Education': 'COEd',
 'College of Arts and Sciences': 'CAS',
 'College of Nursing and Health Sciences': 'CONHS',
 'College of Engineering': 'CoEng',
 'College of Industrial Technology': 'CIT'
};
const normalizeLabel = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

function canonicalDepartment(value) {
 return DEPARTMENTS.find(department =>
  [department, abbreviations[department], `${department} (${abbreviations[department]})`].some(label => normalizeLabel(label) === normalizeLabel(value))
 );
}

const programAliases = {
 'bachelor of information technology': 'Bachelor of Science in Information Technology',
 'bachelor of information system': 'Bachelor of Science in Information Systems',
 'bachelor of science in information system': 'Bachelor of Science in Information Systems',
 'bs-information system': 'Bachelor of Science in Information Systems',
 'bs psychology': 'Bachelor of Science in Psychology',
 'bsed major in science': 'Bachelor of Secondary Education Major in Science',
 'electrical technology': 'Bachelor of Industrial Technology Major in Electrical Technology'
};
function canonicalProgram(department, value) {
 const programs = PROGRAMS[department];
 const key = normalizeLabel(value).replace(/\)$/, '').trim();
 const alias = programAliases[key];
 return programs?.find(program => normalizeLabel(program) === key || program === alias);
}
const nameFields = ['lastName','firstName','middleName','suffix'];
const HASH_FIELDS=['uid','studentId','fullName',...nameFields,'college','program','yearLevel','studentStanding','enrollmentStatus','academicYear','role','accountStatus','isActive','activationStatus','institutionalEmail','email','authEmail','academicRevision','accountRemoved','accountRemovalPending','standingManagedDisabled'];
function bad(message){const e=Error(message);e.code='invalid-argument';throw e;}
function text(v,max,label,optional=false){if(typeof v!=='string'||v.trim().length>max||(!optional&&!v.trim()))bad(`Invalid ${label}.`);return v.trim();}
function academicYear(value){if(typeof value!=='string'||!/^\d{4}-\d{4}$/.test(value)||Number(value.slice(5))!==Number(value.slice(0,4))+1)bad('Academic year must be YYYY-YYYY, for example 2026-2027.');return value;}
function studentName(row) {
 const names = Object.fromEntries(nameFields.map(key => [key, text(row[key] ?? '', 100, key, ['middleName','suffix'].includes(key))]));
 const initial = Array.from(names.middleName)[0]?.toLocaleUpperCase('en') || '';
 return {...names,fullName:[names.firstName,initial && initial+'.',names.lastName,names.suffix].filter(Boolean).join(' ')};
}
function normalizeRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>500)bad('Import 1–500 rows.');
 const ids=new Set(),emails=new Set();
 return rows.map((r,i)=>{
  try{
   if(!r||typeof r!=='object'||Array.isArray(r))bad('Invalid row.');
   if(Object.keys(r).some(k=>!['studentId','fullName','department','program','yearLevel','email','status','enrollmentStatus',...nameFields].includes(k)))bad('Use only the template columns.');
   const studentId=text(r.studentId,64,'Student ID');if(!/^\d{1,64}$/.test(studentId))bad('Student ID must contain digits only; preserve leading zeros.');
   if(ids.has(studentId))bad('Duplicate Student ID in this file.');ids.add(studentId);
   const names = nameFields.some(key => Object.hasOwn(r,key)) ? studentName(r) : {};
   const fullName=text(names.fullName || r.fullName,120,'full name');
   const department=canonicalDepartment(text(r.department,160,'department'));
   if(!department)bad('Select a department from the template guide.');
   const program=canonicalProgram(department,text(r.program,160,'program'));
   if(!program)bad('Program does not match the selected department.');
   const yearLevel=text(r.yearLevel,20,'year level');
   if(!/^[1-6]$/.test(yearLevel))bad('Year level must be 1–6.');
   if(fullName.length<2)bad('Full name must contain at least two characters.');
   const email=text(r.email??'',200,'email',true).toLowerCase();
   if(email&&(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||/@(?:student\.)?ssu-usc\.local$/i.test(email)))bad('Enter a real email address.');
   if(email&&emails.has(email))bad('Duplicate email in this file.');if(email)emails.add(email);
   const status=text(r.status||'active',30,'status').toLowerCase();if(!STATUSES.includes(status))bad('Unknown student status.');
   const enrollmentStatus=r.enrollmentStatus === undefined ? enrollment(status) : text(r.enrollmentStatus,60,'enrollment status');
   return {studentId,...names,fullName,department,program,yearLevel,email,status,enrollmentStatus};
  }catch(e){return{row:i+2,error:e.message,studentId:String(r?.studentId??'').slice(0,64)};}
 });
}
function fingerprint(profile){return createHash('sha256').update(JSON.stringify(HASH_FIELDS.map(k=>[k,profile?.[k]??null]))).digest('hex');}
function enrollment(status){return status==='active'?'Enrolled':status==='leave'?'Leave':'Not Enrolled';}
function studentUid(studentId){return 'annual_'+createHash('sha256').update(studentId).digest('hex').slice(0,40);}
function academicSnapshot(p){return Object.fromEntries(['studentId','fullName',...nameFields,'college','program','yearLevel','studentStanding','enrollmentStatus','academicYear'].map(k=>[k,p?.[k]??null]));}
function yearLabel(value){return ({'1':'1st Year','2':'2nd Year','3':'3rd Year','4':'4th Year','5':'5th Year','6':'6th Year'})[value];}
function nextAcademicProfile(before,row,year){
 academicYear(year);
 if(before?.academicYear&&before.academicYear>year)bad('This import is older than the student’s current academic year.');
 if(before&&!['student','officer'].includes(before.role))bad('This Student ID belongs to a protected role.');
 const activated=before?.activationStatus!=='pending'&&before?.activationStatus!=='processing';
 const approved=before?.accountStatus==='approved';
 return {fullName:row.fullName,college:canonicalDepartment(row.department)||row.department,program:canonicalProgram(canonicalDepartment(row.department),row.program)||row.program,yearLevel:yearLabel(row.yearLevel),studentStanding:row.status,enrollmentStatus:enrollment(row.status),academicYear:year,isActive:row.status==='active'&&approved&&activated};
}
module.exports={STATUSES,DEPARTMENTS,canonicalDepartment,canonicalProgram,academicYear,normalizeRows,fingerprint,enrollment,studentUid,academicSnapshot,nextAcademicProfile};
