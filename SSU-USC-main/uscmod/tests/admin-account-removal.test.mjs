import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAccountRemovalService} from '../supabase/functions/usc-email/account-removal.mjs';
function fixture(){
 const records=new Map([
 ['users/admin',{data:{role:'admin',accountStatus:'approved',isActive:true},version:1}],
 ['users/student',{data:{role:'student',accountStatus:'suspended',isActive:false,studentId:'001'},version:1}],
 ['historical/ballot',{data:{candidate:'one'},version:1}]
 ]),gmail=new Map([['student',{verified_email:'linked@gmail.com',verification_token_hash:'old-token'}]]);
 const actor={uid:'admin',role:'admin',authTime:1000};let sequence=0,disabled=false;
 const deps={now:()=>1000000,randomToken:()=>`audit-${++sequence}`,get:async path=>structuredClone(records.get(path)),
 commit:async ops=>{
 for(const op of ops)if((records.get(op.path)?.version||null)!==op.version)throw Error('version conflict');
 for(const op of ops)records.set(op.path,{data:{...records.get(op.path)?.data,...op.data},version:(records.get(op.path)?.version||0)+1});
 },disableAuth:async()=>{disabled=true;},unlinkGmail:async uid=>gmail.delete(uid)};
 return {records,gmail,actor,deps,remove:(uid='student')=>createAccountRemovalService(deps)(actor,uid),disabled:()=>disabled};
}
for(const role of ['student','officer'])test(`suspended ${role} removal disables login, detaches Gmail and retains UID/history`,async()=>{
 const h=fixture();h.records.get('users/student').data.role=role;await h.remove();
 assert.equal(h.records.get('users/student').data.accountRemoved,true);assert.equal(h.disabled(),true);assert.equal(h.gmail.has('student'),false);
 assert.equal(h.records.get('historical/ballot').data.candidate,'one');assert.equal(h.records.get('users/student').data.studentId,'001');
 const audits=[...h.records.values()].map(v=>v.data).filter(v=>v.action);
 assert.deepEqual(audits.map(v=>v.action),['USER_REMOVAL_STARTED','USER_REMOVED']);assert.ok(audits.every(v=>v.actorUid==='admin'&&v.targetUid==='student'&&v.createdAtMs===1000000));
 await h.remove();assert.equal([...h.records.values()].filter(v=>v.data.action).length,2);
});
for(const change of [h=>h.actor.disabled=true,h=>h.actor.role='officer',h=>h.actor.authTime=0,h=>h.records.get('users/admin').data.isActive=false,h=>h.records.get('users/student').data.accountStatus='approved',h=>h.records.get('users/student').data.role='admin'])test('unauthorized, stale, active or admin target removal is rejected before mutation',async()=>{
 const h=fixture();change(h);await assert.rejects(h.remove());assert.equal(h.gmail.has('student'),true);assert.equal(h.disabled(),false);assert.equal(h.records.get('users/student').data.accountRemovalPending,undefined);
});
test('self and invalid target UIDs are rejected',async()=>{
 const h=fixture();for(const uid of ['admin','../student',''])await assert.rejects(h.remove(uid));assert.equal(h.disabled(),false);
});
for(const step of ['disableAuth','unlinkGmail'])test(`failed ${step} leaves suspended pending account visible and retry succeeds`,async()=>{
 const h=fixture(),original=h.deps[step];h.deps[step]=async()=>{throw Error('unavailable');};await assert.rejects(h.remove());
 const data=h.records.get('users/student').data;assert.equal(data.accountRemovalPending,true);assert.equal(data.accountRemoved,undefined);assert.equal(data.isActive,false);
 h.deps[step]=original;await h.remove();assert.equal(h.records.get('users/student').data.accountRemoved,true);
});
test('final audit failure does not mark removal successful and retry is safe',async()=>{
 const h=fixture(),commit=h.deps.commit;h.deps.commit=async ops=>{if(ops.some(op=>op.data.action==='USER_REMOVED'))throw Error('audit unavailable');return commit(ops);};
 await assert.rejects(h.remove());assert.equal(h.records.get('users/student').data.accountRemovalPending,true);assert.equal(h.records.get('users/student').data.accountRemoved,undefined);
 h.deps.commit=commit;await h.remove();assert.equal(h.records.get('users/student').data.accountRemoved,true);
});
const ui=fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/admin-users.js',import.meta.url),'utf8');
for(const allowed of [true,false])test(`account removal UI requires confirmation (${allowed})`,async()=>{
 let handler;const calls=[],messages=[];
 const ctx=vm.createContext({dom:{removeUserButton:{addEventListener:(_,fn)=>handler=fn}},getSelectedUser:()=>({uid:'student',fullName:'Example',accountStatus:'suspended',isActive:false}),isProtectedAdmin:()=>false,isSaving:false,
 window:{confirm:message=>{messages.push(message);return allowed;}},callStudentEmailService:async(...args)=>calls.push(args),selectedUserIds:new Set(['student']),closeUserEditorModal(){},setFeedback(){}});
 vm.runInContext(ui.slice(ui.indexOf("  dom.removeUserButton.addEventListener('click'"),ui.indexOf("  dom.suspendUserButton.addEventListener('click'")),ctx);
 await handler();assert.equal(calls.length,allowed?1:0);assert.match(messages[0],/Example/);assert.match(messages[0],/Historical complaints, votes, and audit records/);
 if(allowed)assert.equal(calls[0][0],'admin_remove_suspended_account');
});
