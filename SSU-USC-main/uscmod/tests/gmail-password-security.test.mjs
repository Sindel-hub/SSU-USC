import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import {createGmailPasswordAuthenticator,GMAIL_LOGIN_FAILURE} from '../supabase/functions/usc-email/gmail-login.mjs';
function fixture(){
 let row={firebase_uid:'existing-user',requested_email:'verified@gmail.com',verified_email:'verified@gmail.com',verified_at:'2026-11-02'};
 const calls=[],user={uid:'existing-user',email:'001234@student.ssu-usc.local',disabled:false};let waits=0;
 const deps={
  canonicalGmail:email=>typeof email==='string'&&/@gmail\.com$/.test(email)?email:'',
  consumeBudget:async()=>{calls.push('budget');return true;},
  verifiedAccount:async()=>{calls.push('record');return row;},
  authUser:async id=>{calls.push('auth');return id==='existing-user'?user:null;},
  profile:async()=>{calls.push('profile');return {role:'student'};},activeProfile:()=>true,
  authByEmail:async()=>{calls.push('owner');return null;},
  passwordIdentity:async(email,password)=>{calls.push('password');if(email!==user.email||password!=='synthetic-password')throw Error('provider details must not escape');return {uid:user.uid};},
  finishDelay:async()=>{waits++;},
 };
 return {deps,calls,user,revoke:()=>{row=null;},row,waits:()=>waits,run:input=>createGmailPasswordAuthenticator(deps)(input)};
}
const valid={email:'verified@gmail.com',password:'synthetic-password'};
test('account metadata requires successful server-side Firebase password proof',async()=>{
 const h=fixture(),result=await h.run(valid);
 assert.equal(result.status,200);assert.equal(result.body.protocol,'gmail-password-v1');assert.equal(result.body.uid,'existing-user');
 assert.ok(h.calls.indexOf('profile')>h.calls.indexOf('password'));assert.equal(h.waits(),1);
});
test('absent, pending, wrong password, disabled and conflicting identities have identical rejection bodies',async()=>{
 const results=[];
 for(const mode of ['absent','pending','wrong','disabled','conflict']){
  const h=fixture();if(mode==='absent')h.revoke();if(mode==='pending')h.row.verified_email=null;
  if(mode==='disabled')h.user.disabled=true;if(mode==='conflict')h.deps.authByEmail=async()=>({uid:'different-user'});
  results.push(await h.run({...valid,password:mode==='wrong'?'wrong':valid.password}));assert.equal(h.waits(),1);
 }
 for(const result of results)assert.deepEqual(result,{status:401,body:{ok:false,message:GMAIL_LOGIN_FAILURE}});
});
test('email-only public requests receive no UID, alias or token',async()=>{
 const h=fixture(),result=await h.run({email:valid.email});assert.equal(result.status,401);
 for(const key of ['uid','authEmail','idToken','refreshToken'])assert.equal(result.body[key],undefined);
 assert.deepEqual(h.calls,['budget']);assert.equal(h.waits(),1);
});
test('failed proof never queries account profile or exposes provider details',async()=>{
 const h=fixture(),result=await h.run({...valid,password:'wrong'});assert.equal(result.status,401);
 assert.equal(h.calls.includes('profile'),false);assert.equal(JSON.stringify(result).includes('provider details'),false);
});
test('budget rejection prevents every account/provider lookup',async()=>{
 const h=fixture();h.deps.consumeBudget=async()=>false;const result=await h.run(valid);
 assert.equal(result.status,429);assert.deepEqual(h.calls,[]);assert.equal(h.waits(),1);
});
test('missing or failed shared limiter fails closed before every account/provider lookup',async()=>{
 const h=fixture();h.deps.consumeBudget=async()=>{throw Error('database unavailable');};const result=await h.run(valid);
 assert.equal(result.status,503);assert.equal(result.body.uid,undefined);assert.deepEqual(h.calls,[]);assert.equal(h.waits(),1);
});
test('proof for the wrong Firebase UID is rejected',async()=>{
 const h=fixture();h.deps.passwordIdentity=async()=>({uid:'other-user'});
 const result=await h.run(valid);assert.equal(result.status,401);assert.equal(result.body.uid,undefined);
});
test('Gmail removed during password verification is rechecked and rejected',async()=>{
 const h=fixture();h.deps.passwordIdentity=async()=>{h.revoke();return {uid:'existing-user'};};
 assert.equal((await h.run(valid)).status,401);
});
test('unknown Gmail still follows a synthetic password-proof path without a school-account lookup',async()=>{
 const h=fixture();h.revoke();let destination;
 h.deps.passwordIdentity=async email=>{destination=email;throw Error('invalid');};
 assert.equal((await h.run(valid)).status,401);assert.equal(destination,'unavailable@invalid.invalid');assert.equal(h.calls.includes('profile'),false);
});
test('oversized or malformed credentials consume a budget but return no identity',async()=>{
 for(const input of [{email:{},password:'x'},{email:valid.email,password:'x'.repeat(4097)},{email:'x'.repeat(255),password:'x'}]){
  const h=fixture();assert.equal((await h.run(input)).status,401);assert.deepEqual(h.calls,['budget']);
 }
});
test('frontend rejects legacy successful metadata responses without the password-proof protocol',async()=>{
 const source=fs.readFileSync(new URL('../shared/supabase-email-service.js',import.meta.url),'utf8')
  .replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'')
  .replaceAll('import.meta.url',JSON.stringify(import.meta.url));
 const ctx=vm.createContext({URL,auth:{currentUser:null},fetch:async()=>({ok:true,json:async()=>({ok:true,uid:'existing-user',authEmail:'private-alias'})})});
 vm.runInContext(source,ctx);
 await assert.rejects(ctx.authenticateVerifiedGmailLogin(valid.email,valid.password),/could not be verified/);
});

function providerContext(fetch) {
 const source=fs.readFileSync(new URL('../supabase/functions/_shared/usc-email-common.ts',import.meta.url),'utf8');
 const selected=source.slice(source.indexOf('export async function firebasePasswordIdentity'));
 const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,
  env:()=>({firebaseWebApiKey:'synthetic-public-test-key'}),
  Deno:{env:{get:()=> 'synthetic-rate-limit-key-not-a-production-secret'}},fetch,
 });
 vm.runInContext(stripTypeScriptTypes(selected).replace(/export /g,''),ctx);return ctx;
}
test('real Firebase password adapter uses the password endpoint and discards provider session tokens',async()=>{
 let sent;
 const ctx=providerContext(async(url,options)=>{
  sent={url,body:JSON.parse(options.body)};
  return {ok:true,json:async()=>({localId:'existing-user',idToken:'synthetic-discarded',refreshToken:'synthetic-discarded'})};
 });
 const result=await ctx.firebasePasswordIdentity('school@example.invalid','synthetic-password');
 assert.equal(sent.url,'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-public-test-key');
 assert.equal(sent.body.password,'synthetic-password');assert.equal(sent.body.returnSecureToken,false);
 assert.deepEqual(Object.keys(result),['uid']);assert.equal(result.uid,'existing-user');
 const failed=providerContext(async()=>({ok:false,json:async()=>({error:{message:'sensitive-provider-detail'}})}));
 await assert.rejects(failed.firebasePasswordIdentity('school@example.invalid','synthetic-password'),/Invalid sign-in credentials/);
});
test('real rate-limit hash is keyed, deterministic and contains no raw email or client address',async()=>{
 const ctx=providerContext(()=>{throw Error('Network forbidden');});
 const first=await ctx.gmailRateLimitHash('identity:verified@gmail.com');
 assert.match(first,/^[a-f0-9]{64}$/);assert.equal(first,await ctx.gmailRateLimitHash('identity:verified@gmail.com'));
 assert.notEqual(first,await ctx.gmailRateLimitHash('client:127.0.0.1'));
});
