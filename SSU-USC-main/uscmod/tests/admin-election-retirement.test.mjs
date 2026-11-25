import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('administration removes directory bulk/export/selection and election controls while retaining individual account actions',()=>{
 const html=read('usc-admin/admin-dashboard/users.html');
 assert.doesNotMatch(html,/bulk|exportFilteredButton|exportSelectedButton|toggleAllUsers|row-selector|candidacyToggle|selectedUserCandidacy|selectedUserVoteStatus/i);
 for(const id of ['verifiedToggle','approveUserButton','suspendUserButton','reactivateUserButton','removeUserButton','resetUserPasswordButton','directoryHorizontalScroll'])assert.match(html,new RegExp(`id="${id}"`));
 const backend=read('functions/index.js');const begin=backend.indexOf('exports.adminUpdateUser =');const end=backend.indexOf('\nexports.',begin+1);assert.doesNotMatch(backend.slice(begin,end),/candidacyApproved|canvasser/);
 for(const file of ['admin-users','admin-dashboard','admin-audit'])assert.doesNotMatch(read(`usc-admin/admin-dashboard/js/${file}.js`),/subscribeVotes|voteSummaryFor|getElectionContext/);
});
test('directory updates do not read or write election collections or candidacy even with an obsolete request payload',async()=>{
 const source=read('shared/security-client.js'),body=source.slice(source.indexOf('async function browserAdminUpdateUser('),source.indexOf('\nfunction complaintClassificationFromRecord'));
 const reads=[],writes=[],old={uid:'student',studentId:'000123',role:'student',studentStanding:'active',accountStatus:'approved',isActive:true,candidacyApproved:false};
 const context=vm.createContext({auth:{currentUser:{uid:'admin',getIdTokenResult:async()=>({claims:{role:'admin'}})}},db:{},doc:(...p)=>p.filter(v=>typeof v==='string').join('/'),collection:()=> 'audit',
 getDoc:async path=>{reads.push(path);return{exists:()=>true,data:()=>old};},normalizeStudentStanding:s=>s||'active',enrollmentStatusForStanding:()=> 'Enrolled',isActiveStudentStanding:s=>s==='active',serverTimestamp:()=>0,
 writeBatch:()=>({update:(path,data)=>writes.push({path,data}),set:(path,data)=>writes.push({path,data}),commit:async()=>{}}),console});
 vm.runInContext(body,context);await context.browserAdminUpdateUser({uid:'student',adminNotes:'Account review',isVerifiedStudent:true,candidacyApproved:true,canvasser:true});
 assert.deepEqual(reads,['users/student']);assert.ok(writes.length>0);
 for(const write of writes){assert.doesNotMatch(write.path,/election|voter/i);assert.equal(Object.hasOwn(write.data,'candidacyApproved'),false);assert.equal(Object.hasOwn(write.data,'canvasser'),false);}
 assert.equal(writes.find(w=>w.path==='users/student').data.isVerifiedStudent,true);assert.equal(old.candidacyApproved,false);
});
function coreContext(extra={}){
 const source=read('usc-admin/admin-dashboard/js/admin-core.js').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
 const context=vm.createContext({console,...extra});vm.runInContext(source,context);return context;
}
test('account audit/export still works without vote columns, retired permission grants or module subscriptions',async()=>{
 let captured;
 const context=coreContext({callSecure:async()=>{},Blob,URL:{createObjectURL:blob=>{captured=blob;return'blob:synthetic';},revokeObjectURL(){}},document:{body:{appendChild(){}},createElement:()=>({click(){},remove(){}})},normalizeOfficerPermissions:p=>p});
 context.exportUsersCsv([{fullName:'Synthetic Officer',role:'officer',accountStatus:'approved',isActive:true,officerPermissionsConfigured:true,officerPermissions:['dashboard.view','elections.view'],yearLevel:'3rd Year'}],new Map(),'synthetic-accounts.csv');
 const csv=await captured.text();assert.match(csv,/Full Name/);assert.match(csv,/Synthetic Officer/);assert.doesNotMatch(csv,/Vote Submitted|elections.view/);
 assert.equal(context.subscribeVotes,undefined);assert.equal(context.applyBulkUpdates,undefined);
});
test('account audit view omits retired election activity without deleting stored audit records',()=>{
 const entries=[{action:'ELECTION_SCHEDULE_SAVE',target:'elections/synthetic'},{action:'CANDIDACY_APPROVED'},{action:'USER_ACCESS_UPDATE',target:'users/student',before:{accountStatus:'pending'},after:{accountStatus:'approved'}}];let result;
 const context=coreContext({db:{},collection:(_,name)=>name,query:ref=>ref,orderBy(){},limit(){},onSnapshot:(_,fn)=>{fn({docs:entries.map((data,index)=>({id:String(index),data:()=>data}))});return()=>{};}});
 context.subscribeRoleLogs(logs=>result=logs);assert.equal(result.length,1);assert.equal(result[0].targetName,'users/student');assert.equal(entries.length,3);
});
