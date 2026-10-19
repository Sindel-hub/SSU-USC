import test from 'node:test';
import assert from 'node:assert/strict';
import {statusBreakdown,pieGradient} from '../usc-admin/overview/js/overview-charts.js';

test('overview status totals match module schedules and saved cancellations without dropping undated records',()=>{
 const now=new Date(2026,9,19,12).getTime();
 const counts=Object.fromEntries(statusBreakdown([{eventDate:'2026-10-19'},{eventDate:'2099-01-01'},{eventDate:'2000-01-01'},{status:'Cancelled'},{}],now));
 assert.deepEqual(counts,{Active:1,Upcoming:1,Completed:1,Cancelled:1,Unscheduled:1});
});
test('pie uses actual proportions and remains empty for zero records',()=>{
 assert.equal(pieGradient([]),'#e8f0f4');
 assert.equal(pieGradient([{value:0,color:'#000'}]),'#e8f0f4');
 assert.equal(pieGradient([{value:1,color:'#111'},{value:3,color:'#222'}]),'conic-gradient(#111 0% 25%,#222 25% 100%)');
});

test('student summary separates tracked sign-ins, account baselines and repeat sessions', async()=>{
 const {summarizeStudentSignIns}=await import('../usc-admin/overview/js/student-signin-model.mjs');
 const report=summarizeStudentSignIns([{department:'Science',signInCount:3,legacyBackfill:true},{department:'Science',signInCount:0},{department:'Education',signInCount:1}]);
 assert.equal(report.knownAccounts,3);assert.equal(report.uniqueStudents,2);assert.equal(report.sessions,4);assert.equal(report.restoredHistorical,1);
 assert.equal(report.departments.reduce((sum,d)=>sum+d.share,0),100);
});
