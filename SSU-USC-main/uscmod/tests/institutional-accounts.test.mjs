import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createInstitutionalAccountService, institutionalAddress } from '../supabase/functions/usc-email/institutional-accounts.mjs';
import { institutionalEmailForDisplay, validateInstitutionalEmail } from '../shared/account-email.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = Date.now();
function setup() {
  let time = timestamp, serial = 0;
  const records = new Map(), mails = [], passwordChanges = [], accounts = new Map();
  const user = { uid: 'student-a', email: '123456@student.ssu-usc.local', authTime: timestamp / 1000, role: '' };
  const profile = { uid: user.uid, studentId: '123456', fullName: 'Ana Student', email: '', institutionalEmail: null, institutionalEmailVerified: false, role: 'student', schoolProvisioned: true, isActive: true, accountStatus: 'approved', studentStanding: 'active', candidacyApproved: true, college: 'Education', permissions: ['unchanged'] };
  function seed(path, data) { records.set(path, { data: structuredClone(data), version: String(++serial) }); }
  seed('users/'+user.uid, profile);
  seed('login_aliases/id_123456', { authEmail: user.email, kind: 'studentId', uid: user.uid });
  for (const collection of ['student_id_claims','school_accounts','student_masterlist']) seed(collection+'/123456',{uid:user.uid,studentId:'123456',institutionalEmail:null});
  accounts.set(user.uid, { ...user, emailVerified: false, disabled: false, password: 'Original!123' });
  const deps = {
    now: () => time, sha256: async value => hash(value), randomToken: () => randomBytes(32).toString('hex'),
    get: async path => structuredClone(records.get(path) || null),
    activeProfile: data => data?.schoolProvisioned && ['student','officer'].includes(data.role) && data.accountStatus==='approved' && data.isActive!==false,
    authUser: async uid => accounts.get(uid) || null,
    authByEmail: async email => [...accounts.values()].find(account=>account.email===email) || null,
    sendVerification: async (email, token) => mails.push({email,token}),
    resetAuthPassword: async (uid,password,time) => {passwordChanges.push({uid,password,time});accounts.get(uid).password=password;},
    commit: async writes => {
      for (const write of writes) assert.equal(records.get(write.path)?.version || null, write.version || null, 'atomic precondition');
      for (const write of writes) {
        if(write.remove)records.delete(write.path);
        else seed(write.path,{...records.get(write.path)?.data,...write.data});
      }
    }
  };
  const service=createInstitutionalAccountService(deps);
  return {service,deps,user,profile,records,mails,accounts,passwordChanges,seed,advance:ms=>time+=ms};
}

test('institutional domains and internal identifier displays are validated consistently',()=>{
  for(const validate of [institutionalAddress,validateInstitutionalEmail]){
    assert.equal(validate(' Student@SSU.EDU.PH '),'student@ssu.edu.ph');
    for(const bad of ['','a@gmail.com','a@ssu.edu.ph.attacker.com','a@student.ssu-usc.local','a@@ssu.edu.ph','a b@ssu.edu.ph'])assert.throws(()=>validate(bad));
  }
  assert.equal(institutionalEmailForDisplay({email:'123456@student.ssu-usc.local'}),'');
  assert.equal(institutionalEmailForDisplay({institutionalEmail:null,email:''}),'');
  assert.equal(institutionalEmailForDisplay({email:'legacy@ssu.edu.ph'}),'legacy@ssu.edu.ph');
});
for(const role of ['student','officer'])test(`${role} verifies mailbox ownership and both aliases retain the same UID, Auth account, password, and permissions`,async()=>{
  const ctx=setup(),{service,user,records,mails,accounts,seed}=ctx;
  seed('users/'+user.uid,{...ctx.profile,role});
  await service.request(user,'ana@ssu.edu.ph');
  assert.equal((await service.status(user)).verified,false);
  assert.equal(records.has('login_aliases/email_'+hash('ana@ssu.edu.ph')),false);
  assert.equal(records.get('users/'+user.uid).data.institutionalEmail,null);
  assert.ok(!JSON.stringify([...records.values()]).includes(mails[0].token),'only a token hash may persist');
  const result=await service.verify(user,mails[0].token);
  assert.equal(result.email,'ana@ssu.edu.ph');
  const updated=records.get('users/'+user.uid).data;
  assert.equal(updated.uid,user.uid);assert.equal(updated.role,role);
  assert.deepEqual(updated.permissions,ctx.profile.permissions);assert.equal(updated.candidacyApproved,true);
  assert.equal(updated.institutionalEmailVerified,true);assert.equal(updated.authEmail,user.email);
  assert.equal(accounts.size,1);assert.equal(accounts.get(user.uid).password,'Original!123');
  for(const path of ['login_aliases/id_123456','login_aliases/email_'+hash('ana@ssu.edu.ph')]){
    assert.equal(records.get(path).data.uid,user.uid);assert.equal(records.get(path).data.authEmail,user.email);
  }
  assert.equal((await service.status(user)).verified,true);
  await assert.rejects(service.verify(user,mails[0].token),/expired, replaced, or already used/);
});
test('verification rejects anonymous/wrong-account tokens, stale sessions, inactive profiles, expired links, and mismatched Auth identity',async()=>{
  const ctx=setup(),{service,user,seed,mails,accounts}=ctx;
  await assert.rejects(service.request({...user,authTime:0},'ana@ssu.edu.ph'),/sign in again/);
  await service.request(user,'ana@ssu.edu.ph');
  await assert.rejects(service.verify({...user,uid:'other'},mails[0].token));
  await assert.rejects(service.verify(user,'a'.repeat(64)),/expired, replaced/);
  seed('users/'+user.uid,{...ctx.profile,isActive:false});await assert.rejects(service.verify(user,mails[0].token),/approved active/);
  seed('users/'+user.uid,ctx.profile);accounts.get(user.uid).email='changed@ssu.edu.ph';await assert.rejects(service.verify(user,mails[0].token),/session has changed/);
  accounts.get(user.uid).email=user.email;ctx.advance(86400001);await assert.rejects(service.verify(user,mails[0].token),/expired/);
});
test('duplicate institutional addresses are rejected for both Firebase owners and existing legacy aliases',async()=>{
  for(const type of ['auth','alias']){
    const {service,user,accounts,seed}=setup();
    if(type==='auth')accounts.set('other',{uid:'other',email:'taken@ssu.edu.ph'});
    else seed('login_aliases/email_'+hash('taken@ssu.edu.ph'),{authEmail:'other@student.ssu-usc.local'});
    await assert.rejects(service.request(user,'taken@ssu.edu.ph'),/another account/);
  }
});
test('verification rechecks ownership and uses atomic preconditions against concurrent alias takeover and replay',async()=>{
  const ctx=setup(),{service,user,mails,seed,records}=ctx;
  await service.request(user,'ana@ssu.edu.ph');
  const path='login_aliases/email_'+hash('ana@ssu.edu.ph');
  seed(path,{uid:'other',authEmail:'other@student.ssu-usc.local'});
  await assert.rejects(service.verify(user,mails[0].token),/another account/);
  assert.equal(records.get('users/'+user.uid).data.institutionalEmail,null);
  records.delete(path);
  const outcomes=await Promise.allSettled([service.verify(user,mails[0].token),service.verify(user,mails[0].token)]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(records.get(path).data.uid,user.uid);
});
test('ownership conflicts in Student ID records prevent any linking writes',async()=>{
  const {service,user,mails,seed,records}=setup();await service.request(user,'ana@ssu.edu.ph');
  seed('student_id_claims/123456',{uid:'other',studentId:'123456'});
  await assert.rejects(service.verify(user,mails[0].token),/ownership records conflict/);
  assert.equal(records.get('users/'+user.uid).data.institutionalEmail,null);
});
test('verification requests are rate-limited and replaced tokens cannot be consumed',async()=>{
  const ctx=setup(),{service,user,mails}=ctx;
  await service.request(user,'ana@ssu.edu.ph');
  await assert.rejects(service.request(user,'ana@ssu.edu.ph'),/one minute/);
  ctx.advance(61000);await service.request(user,'new@ssu.edu.ph');
  await assert.rejects(service.verify(user,mails[0].token),/replaced/);
  for(let i=2;i<5;i++){ctx.advance(61000);await service.request(user,'new@ssu.edu.ph');}
  ctx.advance(61000);await assert.rejects(service.request(user,'new@ssu.edu.ph'),/daily/);
});
test('trusted administrator can issue a temporary password without an institutional inbox; no password or internal email appears in records/result email',async()=>{
  const ctx=setup(),{service,user,seed,records,passwordChanges}=ctx;
  const admin={uid:'admin',email:'admin@ssu.edu.ph',role:'admin',authTime:timestamp/1000};
  seed('users/admin',{role:'admin',isActive:true,accountStatus:'approved'});
  for(const bad of [{...admin,role:''},{...admin,authTime:0},user])await assert.rejects(service.resetPassword(bad,user.uid));
  const result=await service.resetPassword(admin,user.uid);
  assert.equal(result.institutionalEmail,'');assert.equal(result.uid,user.uid);
  assert.match(result.temporaryPassword,/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,64}$/);
  assert.equal(passwordChanges[0].password,result.temporaryPassword);
  assert.ok(!JSON.stringify([...records.values()]).includes(result.temporaryPassword));
  await assert.rejects(service.resetPassword(admin,'admin'),/Select a student/);
});
test('metadata failures after password update still return the issued secret to the admin',async()=>{
  const ctx=setup();ctx.seed('users/admin',{role:'admin',isActive:true,accountStatus:'approved'});
  ctx.deps.commit=async()=>{throw new Error('conflict');};
  const result=await ctx.service.resetPassword({uid:'admin',role:'admin',authTime:timestamp/1000},ctx.user.uid);
  assert.ok(result.temporaryPassword);assert.match(result.warning,/Password changed/);
});
