import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../complaint/js/complaints.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function lastSubmissionMs('),source.indexOf('function normalizedErrorCode('));
const commit=source.slice(source.indexOf('async function commitComplaintAtomically('),source.indexOf('complaintForm?.addEventListener("submit"'));
function setup(age,{existing=false}={}){
 const writes=[];let rateReads=0;
 const snapshot=()=>({data:()=>age===null?{}:{lastSubmittedAt:{toMillis:()=>100000-age}}});
 const ctx=vm.createContext({Date:{now:()=>100000},SUBMISSION_COOLDOWN_MS:20000,db:{},Math,
  doc:(_db,...parts)=>({id:parts.at(-1),path:parts.join('/')}),getDoc:async()=>snapshot(),serverTimestamp:()=>100000,
  withTransientRetry:fn=>fn(),runTransaction:async(_db,fn)=>fn({
   get:async ref=>ref.path.startsWith('complaints/')?{exists:()=>existing}:(rateReads++,snapshot()),
   set:(ref,data)=>writes.push({path:ref.path,data})
  })
 });
 vm.runInContext(helpers+commit,ctx);
 return {ctx,writes,rateReads:()=>rateReads,submit:()=>ctx.commitComplaintAtomically({p:{uid:'student'},payload:{subject:'Complaint'},complaintDocRef:{path:'complaints/one',id:'one'}})};
}
for(const [age,expected] of [[null,0],[1,19999],[19999,1],[20000,0],[20001,0]])test(`complaint cooldown boundary at ${age}ms`,()=>{const h=setup(age);const snap={data:()=>age===null?{}:{lastSubmittedAt:{toMillis:()=>100000-age}}};assert.equal(h.ctx.cooldownRemainingMs(snap),expected);});
test('preflight prevents attachment work during the cooldown',async()=>{const h=setup(5000);await assert.rejects(h.ctx.preflightCooldown('student'),/wait 15 seconds/);assert.equal(h.writes.length,0);});
test('transaction rechecks cooldown and commits no complaint or rate writes on rejection',async()=>{const h=setup(5000);await assert.rejects(h.submit(),/wait 15 seconds/);assert.equal(h.writes.length,0);assert.equal(h.rateReads(),1);});
test('an eligible submission writes the complaint and server timestamp together',async()=>{const h=setup(20000);await h.submit();assert.deepEqual(h.writes.map(w=>w.path),['complaints/one','complaint_rate_limits/student']);assert.equal(h.writes[1].data.lastSubmittedAt,100000);});
test('retry after a successful commit remains idempotent inside the cooldown',async()=>{const h=setup(1000,{existing:true});const result=await h.submit();assert.equal(result.alreadyCommitted,true);assert.equal(h.writes.length,0);assert.equal(h.rateReads(),0);});
