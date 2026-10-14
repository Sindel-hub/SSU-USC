import test from 'node:test';
import assert from 'node:assert/strict';
import { departmentSummary, sortComplaints } from '../usc-admin/complaints/js/complaint-inbox-model.mjs';
const records = [
 {id:'a',studentUid:'one',studentDepartment:'Engineering',status:'Resolved',createdAt:'2026-01-01'},
 {id:'b',studentUid:'one',studentDepartment:'Engineering',status:'Submitted',createdAt:{toMillis:()=>Date.parse('2026-01-03')}},
 {id:'c',studentUid:'two',studentDepartment:'Arts',status:'Under Review',createdAt:'2026-01-02'}
];
test('department analytics count repeat complainants once and retain case totals',()=>{
 assert.deepEqual(departmentSummary(records),[{name:'Arts',students:1,complaints:1},{name:'Engineering',students:1,complaints:2}]);
 assert.deepEqual(departmentSummary([]),[]);
});
test('sorting handles Firestore dates, workflow status and department without mutating records',()=>{
 assert.deepEqual(sortComplaints(records,'newest').map(x=>x.id),['b','c','a']);
 assert.deepEqual(sortComplaints(records,'oldest').map(x=>x.id),['a','c','b']);
 assert.deepEqual(sortComplaints(records,'status').map(x=>x.id),['b','c','a']);
 assert.deepEqual(sortComplaints(records,'department').map(x=>x.id),['c','b','a']);
 assert.deepEqual(records.map(x=>x.id),['a','b','c']);
});
test('missing department records remain visible in analytics',()=>{
 assert.deepEqual(departmentSummary([{id:'x',studentId:'one'},{id:'y',studentId:'one'}]),[{name:'Department not specified',students:1,complaints:2}]);
});
