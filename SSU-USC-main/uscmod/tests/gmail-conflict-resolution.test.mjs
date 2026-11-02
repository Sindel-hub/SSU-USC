// Local synthetic state only; no credentials or production IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGmailPasswordAuthenticator} from '../supabase/functions/usc-email/gmail-login.mjs';
function fixture(){
 let mapping={firebase_uid:'active-uid',requested_email:'personal@gmail.com',verified_email:'personal@gmail.com',verified_at:'synthetic'};
 const users=new Map([['active-uid',{uid:'active-uid',email:'001@student.ssu-usc.local',disabled:false}],['mock-uid',{uid:'mock-uid',email:'personal@gmail.com',disabled:false}]]);
 const profiles=new Map([['active-uid',{role:'student',schoolProvisioned:true,accountStatus:'approved',isActive:true,studentStanding:'active',officerPermissions:[]}],['mock-uid',{role:'student',schoolProvisioned:true,accountStatus:'suspended',isActive:false,studentStanding:'active'}]]);
 const passwords=new Map([['001@student.ssu-usc.local','active-password'],['personal@gmail.com','mock-password']]);
 const owners=new Map([['personal@gmail.com',{uid:'mock-uid'}]]);const calls=[];
 const active=p=>p?.accountStatus==='approved'&&p.isActive!==false&&['student','officer'].includes(p.role)&&p.studentStanding==='active';
 const deps={canonicalGmail:email=>String(email).toLowerCase().split('@')[0].split('+')[0].replaceAll('.','')+'@gmail.com',consumeBudget:async()=>{calls.push('budget');return true;},finishDelay:async()=>{},verifiedAccount:async()=>mapping,authUser:async uid=>users.get(uid)||null,authByEmail:async email=>owners.get(email)||null,profile:async uid=>profiles.get(uid)||null,activeProfile:active,activeNativeProfile:p=>active(p)||(p?.role==='admin'&&p.accountStatus==='approved'&&p.isActive!==false),passwordIdentity:async(email,password)=>{calls.push(email);if(passwords.get(email)!==password)throw Error('invalid');const user=[...users.values()].find(u=>u.email===email);return {uid:user.uid};}};
 return {users,profiles,owners,deps,calls,get mapping(){return mapping;},set mapping(value){mapping=value;},run:(password='active-password',email='personal@gmail.com')=>createGmailPasswordAuthenticator(deps)({email,password}),snapshot:()=>JSON.stringify({users:[...users],profiles:[...profiles],mapping})};
}
test('verified mapping wins over suspended native mock without modifying either account',async()=>{
 const h=fixture(),before=h.snapshot(),result=await h.run();assert.equal(result.status,200);assert.equal(result.body.uid,'active-uid');assert.equal(result.body.loginMethod,'verified-gmail');
 assert.deepEqual(h.calls,['budget','001@student.ssu-usc.local']);assert.equal(h.snapshot(),before);
});
for(const state of ['suspended','inactive','disabled'])test(`mapped account ${state} remains blocked`,async()=>{
 const h=fixture();if(state==='disabled')h.users.get('active-uid').disabled=true;else if(state==='inactive')h.profiles.get('active-uid').isActive=false;else h.profiles.get('active-uid').accountStatus='suspended';
 const result=await h.run();assert.equal(result.status,401);assert.equal(result.body.uid,undefined);
});
for(const state of ['active','admin','missing-profile','missing-auth'])test(`conflicting ${state} native owner stays fail-closed`,async()=>{
 const h=fixture();if(state==='active')Object.assign(h.profiles.get('mock-uid'),{accountStatus:'approved',isActive:true});
 if(state==='admin')h.profiles.get('mock-uid').role='admin';if(state==='missing-profile')h.profiles.delete('mock-uid');if(state==='missing-auth')h.users.delete('mock-uid');
 assert.equal((await h.run()).status,401);
});
test('disabled Auth with active Firestore profile is ambiguous and stays blocked',async()=>{
 const h=fixture();Object.assign(h.profiles.get('mock-uid'),{accountStatus:'approved',isActive:true});h.users.get('mock-uid').disabled=true;
 assert.equal((await h.run()).status,401);assert.equal(h.users.get('mock-uid').disabled,true);
});
test('old mock password cannot authenticate the mapped student or fall back to another UID',async()=>{
 const h=fixture();const result=await h.run('mock-password');assert.equal(result.status,401);assert.equal(result.body.uid,undefined);assert.deepEqual(h.calls,['budget','001@student.ssu-usc.local']);
});
test('reactivation before conflict validation blocks the ambiguous mapped login',async()=>{
 const h=fixture(),proof=h.deps.passwordIdentity;h.deps.passwordIdentity=async(...args)=>{Object.assign(h.profiles.get('mock-uid'),{accountStatus:'approved',isActive:true});return proof(...args);};
 assert.equal((await h.run()).status,401);
});
for(const change of ['removed','uid-changed'])test(`mapping ${change} during proof cannot authenticate a stale UID`,async()=>{
 const h=fixture(),proof=h.deps.passwordIdentity;h.deps.passwordIdentity=async(...args)=>{const identity=await proof(...args);if(change==='removed')h.mapping=null;else h.mapping.firebase_uid='mock-uid';return identity;};
 assert.equal((await h.run()).status,401);
});
test('native Gmail still uses its existing UID when no verified mapping exists',async()=>{
 const h=fixture();h.mapping=null;Object.assign(h.profiles.get('mock-uid'),{accountStatus:'approved',isActive:true});const before=h.snapshot();
 const result=await h.run('mock-password');assert.equal(result.status,200);assert.equal(result.body.uid,'mock-uid');assert.equal(result.body.loginMethod,'firebase-native');assert.equal(h.snapshot(),before);
});
test('native suspended account without a mapping stays blocked',async()=>{
 const h=fixture();h.mapping=null;assert.equal((await h.run('mock-password')).status,401);
});
test('native administrator remains password-gated and retains its UID',async()=>{
 const h=fixture();h.mapping=null;Object.assign(h.profiles.get('mock-uid'),{role:'admin',accountStatus:'approved',isActive:true});
 const result=await h.run('mock-password');assert.equal(result.status,200);assert.equal(result.body.uid,'mock-uid');assert.equal(h.profiles.get('mock-uid').role,'admin');
});
test('a mapping created during native password proof prevents native UID selection',async()=>{
 const h=fixture(),mapping=h.mapping;h.mapping=null;Object.assign(h.profiles.get('mock-uid'),{accountStatus:'approved',isActive:true});const proof=h.deps.passwordIdentity;
 h.deps.passwordIdentity=async(...args)=>{const identity=await proof(...args);h.mapping=mapping;return identity;};assert.equal((await h.run('mock-password')).status,401);
});
test('canonical and original-address conflicts are both checked',async()=>{
 const h=fixture();h.users.set('other-uid',{uid:'other-uid',email:'p.ersonal+tag@gmail.com',disabled:false});h.profiles.set('other-uid',{role:'student',accountStatus:'approved',isActive:true});h.owners.set('p.ersonal+tag@gmail.com',{uid:'other-uid'});
 assert.equal((await h.run('active-password','p.ersonal+tag@gmail.com')).status,401);
});
test('ambiguous native Gmail aliases do not select either Firebase account',async()=>{
 const h=fixture();h.mapping=null;h.owners.set('p.ersonal+tag@gmail.com',{uid:'other-uid'});assert.equal((await h.run('mock-password','p.ersonal+tag@gmail.com')).status,401);
});
for(const unavailable of [false,true])test(`budget gate remains before all password/identity work (${unavailable?'unavailable':'exhausted'})`,async()=>{
 const h=fixture();h.deps.consumeBudget=async()=>{if(unavailable)throw Error('unavailable');return false;};
 const result=await h.run();assert.equal(result.status,unavailable?503:429);assert.deepEqual(h.calls,[]);
});

for(const status of ['approved','suspended'])test(`explicit inactive legacy profile remains an allowed conflict (${status})`,async()=>{
 const h=fixture();h.profiles.get('mock-uid').accountStatus=status;assert.equal((await h.run()).body.uid,'active-uid');
 assert.equal(h.profiles.get('mock-uid').isActive,false);
});
for(const kind of ['pending','missing-status','missing-active','string-active','suspended-but-active'])test(`unknown or contradictory legacy state fails closed (${kind})`,async()=>{
 const h=fixture(),profile=h.profiles.get('mock-uid');
 if(kind==='pending')profile.accountStatus='pending';if(kind==='missing-status')delete profile.accountStatus;
 if(kind==='missing-active')delete profile.isActive;if(kind==='string-active')profile.isActive='false';if(kind==='suspended-but-active')profile.isActive=true;
 assert.equal((await h.run()).status,401);
});
test('exception requires explicit active target, not an omitted activity flag',async()=>{
 const h=fixture();delete h.profiles.get('active-uid').isActive;assert.equal((await h.run()).status,401);
});
test('two different inactive owners across Gmail aliases remain ambiguous',async()=>{
 const h=fixture();h.users.set('second-mock',{uid:'second-mock',email:'p.ersonal+tag@gmail.com',disabled:false});h.profiles.set('second-mock',{role:'student',accountStatus:'suspended',isActive:false});h.owners.set('p.ersonal+tag@gmail.com',{uid:'second-mock'});
 assert.equal((await h.run('active-password','p.ersonal+tag@gmail.com')).status,401);
});
test('stale owner email or incomplete Auth status cannot prove the legacy exception',async()=>{
 for(const kind of ['changed-email','unknown-disabled']){
 const h=fixture();if(kind==='changed-email')h.users.get('mock-uid').email='different@gmail.com';else delete h.users.get('mock-uid').disabled;
 assert.equal((await h.run()).status,401);
 }
});

test('same legacy UID with an equivalent Gmail alias retains canonical-mailbox matching',async()=>{
 const h=fixture();h.users.get('mock-uid').email='p.ersonal+tag@gmail.com';assert.equal((await h.run()).body.uid,'active-uid');
});
