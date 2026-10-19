import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {IMPORT_FIELDS,detectColumns,mapRows,csvContent,importSummary} from '../usc-admin/admin-dashboard/js/student-import-model.mjs';
import {SSU_PROGRAMS} from '../usc-admin/student-registration/js/ssu-programs.js';
const require=createRequire(import.meta.url),{validateRow}=require('../functions/student-import.js'),XLSX=require('@e965/xlsx');
const valid={fullName:'Ana Student',studentId:'123456',institutionalEmail:'ANA@EXAMPLE.EDU',college:'College of Education',program:'Bachelor of Elementary Education',yearLevel:'1'};
test('backend reuses the manual program catalog, canonicalizes identities and validates every required field',()=>{
 assert.deepEqual(require('../functions/ssu-programs.json'),SSU_PROGRAMS);
 const {row}=validateRow(valid);assert.equal(row.yearLevel,'1st Year');assert.equal(row.institutionalEmail,'ana@example.edu');assert.equal(validateRow({...valid,studentId:'123-456'}).row.studentId,'123456');
 for(const [key,value] of [['fullName',''],['studentId','1234567'],['institutionalEmail','not-email'],['program','Invented program'],['college','Other'],['yearLevel','6'],['fullName','x'.repeat(121)]])assert.ok(validateRow({...valid,[key]:value}).error,key);
});
test('Google Forms column detection and manual/default mappings preserve values and source rows',()=>{
 const headers=['Timestamp','Full Name','Student ID Number','Email Address','Course','Year Level','College'];const mapping=detectColumns(headers);
 assert.equal(mapping.studentId,'2');assert.equal(mapping.institutionalEmail,'3');
 const rows=mapRows([headers,['','Ana','001234','ANA@EXAMPLE.EDU','Program','1','College'],['','Ben','001-234','ben@example.edu','Program','1','College'],['','Cat','567890','ana@example.edu','Program','1','College']],mapping);
 assert.equal(rows[0].studentId,'001234');assert.equal(rows[0].sourceRow,2);assert.equal(rows[1].status,'duplicate');assert.equal(rows[2].status,'duplicate');
 assert.throws(()=>mapRows([headers,['a']],{...mapping,fullName:'2'}),/only one field/);
 const defaults=mapRows([['Student ID','Full name','Email'],['001234','Ana Student','a@example.edu']],{studentId:'0',fullName:'1',institutionalEmail:'2',college:'',program:'',yearLevel:''},{college:valid.college,program:valid.program,yearLevel:'1st Year'});assert.equal(defaults[0].program,valid.program);
 assert.throws(()=>mapRows([headers,...Array.from({length:1001},()=>['','Ana','123456'])],mapping),/1,000|1000/);
});
test('CSV exports escape quotes, newlines and spreadsheet formulas; summaries count actual states',()=>{
 const csv=csvContent(['Name','Message'],[['=HYPERLINK("bad")','a,\nb'],[' +SUM(1)','"quoted"']]);
 assert.match(csv,/"'=HYPERLINK\(""bad""\)"/);assert.match(csv,/"a,\nb"/);assert.match(csv,/"' \+SUM/);
 assert.deepEqual(importSummary([{status:'created'},{status:'existing'},{status:'failed'}]),{total:3,created:1,existing:1,failed:1});
});
const worker=fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/student-import-worker.js',import.meta.url),'utf8');
function parse(bytes,sheet){let result;const context={XLSX,importScripts:()=>{},postMessage:data=>result=data};vm.runInNewContext(worker+';globalThis.run=onmessage;',context);context.run({data:{bytes,sheet}});return result;}
for(const bookType of ['xlsx','biff8','csv'])test(`worker reads actual ${bookType} files with literal strings and sheet selection`,()=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Full name','Student ID'],['<img onerror=bad()>','001234']]),'Students');
 const parsed=parse(XLSX.write(book,{type:'array',bookType}));assert.equal(parsed.matrix[1][1],'001234');assert.equal(parsed.matrix[1][0],'<img onerror=bad()>');
});
test('worker rejects oversized worksheets and excessive cell content without execution',()=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Name'],['a'.repeat(1001)]]),'Students');assert.ok(parse(XLSX.write(book,{type:'array',bookType:'xlsx'})).error);
 const large=XLSX.utils.book_new();XLSX.utils.book_append_sheet(large,XLSX.utils.aoa_to_sheet(Array.from({length:1002},()=>['Student'])),'Students');assert.ok(parse(XLSX.write(large,{type:'array',bookType:'xlsx'})).error);
});
test('import calls only server endpoints, and first-login enforcement is connected at login and protected routes',()=>{
 const source=fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/student-import.js',import.meta.url),'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|console\.|createUserWithEmailAndPassword/);assert.match(source,/previewStudentAccountImport/);assert.match(source,/importStudentAccounts/);
 for(const file of ['../shared/auth-guard.js','../index/js/index.js'])assert.match(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/mustChangePassword[\s\S]*required-password\.html/);
});
test('vendored parser matches the pinned installed distribution byte for byte',()=>{
 assert.equal(XLSX.version,'0.20.3');
 assert.deepEqual(fs.readFileSync(new URL('../vendor/sheetjs/xlsx.full.min.js',import.meta.url)),fs.readFileSync(require.resolve('@e965/xlsx/dist/xlsx.full.min.js')));
});
