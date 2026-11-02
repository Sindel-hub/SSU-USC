// Node-only: real provider/Edge code, synthetic configuration, intercepted IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto,createHmac,createHash} from 'node:crypto';
import {createAccountRemovalService} from '../supabase/functions/usc-email/account-removal.mjs';
import {createGmailPasswordAuthenticator} from '../supabase/functions/usc-email/gmail-login.mjs';
import {createInstitutionalAccountService} from '../supabase/functions/usc-email/institutional-accounts.mjs';
const common=fs.readFileSync(new URL('../supabase/functions/_shared/usc-email-common.ts',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/usc-email/index.ts',import.meta.url),'utf8');
const compile=text=>stripTypeScriptTypes(text,{mode:'transform'}).replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/\bexport\s+/g,'');
const scriptUrl='https://script.google.com/macros/s/synthetic-deployment/exec';
const syntheticSecret='a'.repeat(64);
function harness({settings={},failure='',role='student'}={}){
 const vars={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role',FIREBASE_PROJECT_ID:'synthetic-firebase',FIREBASE_WEB_API_KEY:'synthetic-api-key',PORTAL_URL:'https://portal.invalid/',EMAIL_PROVIDER:'apps-script',APPS_SCRIPT_EMAIL_URL:scriptUrl,APPS_SCRIPT_EMAIL_SECRET:syntheticSecret,...settings};
 const calls=[],logs=[],resetIdentities=[];let handler,row=null,timeout,institutionalDelivery;
 const uid='synthetic-user',profile={role,accountStatus:'approved',isActive:true,schoolProvisioned:true,studentStanding:'active'};
 function query(){
  const filters=[];let operation,patch;
  const execute=()=>{
   if(operation==='upsert')row={...row,...patch};
   const matches=row&&filters.every(f=>f(row));
   if(operation==='update'&&matches)row={...row,...patch};
   if(operation==='delete'&&matches)row=null;
   return {data:matches?row:null,error:null};
  };
  return {select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},neq(k,v){filters.push(r=>r[k]!==v);return this;},upsert(v){operation='upsert';patch=v;return this;},update(v){operation='update';patch=v;return this;},delete(){operation='delete';return this;},maybeSingle:async()=>execute(),then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};
 }
 const ctx=vm.createContext({Request,Response,Headers,URL,URLSearchParams,Date,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,atob,btoa,setTimeout,
  AbortSignal:{timeout:ms=>{timeout=ms;return new AbortController().signal;}},
  Deno:{env:{get:name=>vars[name]},serve:fn=>handler=fn},console:{error(){},warn(){}},
  createClient:()=>({from:()=>query()}),createAccountRemovalService,createGmailPasswordAuthenticator,
  createInstitutionalAccountService:deps=>{institutionalDelivery=deps.sendVerification;return createInstitutionalAccountService(deps);},
  fetch:async(url,options)=>{
   assert.ok([scriptUrl,'https://api.resend.com/emails'].includes(url),'No external/provider identity calls permitted');
   calls.push({url,options});
   if(failure==='network')throw Error('sensitive provider diagnostic');
   if(url==='https://api.resend.com/emails')return {ok:!failure,status:failure?401:200,json:async()=>({id:'synthetic-resend-id'})};
   const envelope=JSON.parse(options.body);
   return {ok:failure!=='http',status:failure==='http'?500:200,json:async()=>{
    if(failure==='json')throw Error('not json');
    return {ok:!['RATE_LIMITED','UNAUTHORIZED','CONFIGURATION'].includes(failure),id:failure==='mismatch'?'wrong-id':`apps-script:${envelope.requestId}`,code:failure};
   }};
  }
 });
 vm.runInContext(compile(common),ctx);
 const startEdge=()=>{
  Object.assign(ctx,{
   verifyFirebaseIdToken:async token=>{if(!token)throw Error('Missing synthetic session');return {uid,email:'001@student.ssu-usc.local',role,authTime:Date.now()/1000};},
   firestoreGet:async()=>profile,
   firebaseUserByUid:async()=>({uid,email:'001@student.ssu-usc.local',disabled:false}),
   generateFirebaseResetLink:async email=>{resetIdentities.push(email);return 'https://synthetic.invalid/reset?oobCode=synthetic';},
   logDelivery:async event=>logs.push(event)
  });
  vm.runInContext(compile(edge),ctx);
 };
 return {ctx,calls,logs,resetIdentities,vars,startEdge,get row(){return row;},set row(value){row=value;},timeout:()=>timeout,sendInstitutional:(...args)=>institutionalDelivery(...args),
  post:async(body,session=true)=>handler(new Request('https://synthetic.invalid/functions/v1/usc-email',{method:'POST',headers:{'Content-Type':'application/json',...(session?{'x-firebase-token':'synthetic-session'}:{})},body:JSON.stringify(body)}))};
}
test('provider implementation bodies match the retrieved production v21 source byte-for-byte',()=>{
 const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/usc-email-v21-provenance.json',import.meta.url),'utf8'));
 for(const [name,hash] of Object.entries(baseline.unchangedProviderBodySha256)){
  const start=new RegExp('^(?:export )?(?:async )?function '+name+'\\(','m').exec(common).index;
  const next=/^(?:export )?(?:async )?function \w+\(/m.exec(common.slice(start+1));
  const block=common.slice(start,next?start+1+next.index:common.length).trim();const body=block.slice(block.indexOf('{')).trim();
  assert.equal(createHash('sha256').update(body).digest('hex'),hash,name);
 }
});
test('Apps Script payload preserves Unicode, kind, timestamp and body HMAC contract',async()=>{
 const h=harness();const id=await h.ctx.sendEmail('recipient@gmail.com','Résumé ✓','<p>Hi ✓</p>','Text ✓','password_recovery');
 const {url,options}=h.calls[0],body=JSON.parse(options.body);assert.equal(url,scriptUrl);assert.equal(body.version,1);
 assert.match(body.requestId,/^[a-f0-9]{32}$/);assert.ok(Math.abs(body.timestamp-Date.now())<10000);
 const expected=createHmac('sha256',syntheticSecret).update(`1\n${body.timestamp}\n${body.requestId}\n${body.payload}`).digest('hex');
 assert.equal(body.signature,expected);assert.equal(id,`apps-script:${body.requestId}`);
 assert.deepEqual(JSON.parse(Buffer.from(body.payload,'base64').toString('utf8')),{to:'recipient@gmail.com',subject:'Résumé ✓',html:'<p>Hi ✓</p>',text:'Text ✓',kind:'password_recovery'});
 assert.equal(options.headers.Authorization,undefined);assert.equal(options.body.includes(syntheticSecret),false);assert.equal(options.redirect,'follow');assert.equal(h.timeout(),25000);
});
test('Apps Script default kind remains transactional and does not require Resend credentials',async()=>{
 const h=harness();await h.ctx.sendEmail('recipient@gmail.com','Subject','HTML','Text');
 assert.equal(JSON.parse(Buffer.from(JSON.parse(h.calls[0].options.body).payload,'base64')).kind,'transactional');
 assert.equal(h.vars.RESEND_API_KEY,undefined);assert.equal(h.calls.length,1);
});
test('settings initialization does not require unused provider credentials',()=>{
 const h=harness({settings:{APPS_SCRIPT_EMAIL_URL:undefined,APPS_SCRIPT_EMAIL_SECRET:undefined}});assert.doesNotThrow(()=>h.ctx.adminClient());assert.equal(h.ctx.env().emailProvider,'apps-script');
});
for(const provider of [undefined,'resend',' ReSeNd '])test(`Resend remains explicit/default provider: ${provider}`,async()=>{
 const h=harness({settings:{EMAIL_PROVIDER:provider,RESEND_API_KEY:'synthetic-resend-key',EMAIL_FROM:'Portal <noreply@example.invalid>'}});
 assert.equal(await h.ctx.sendEmail('recipient@gmail.com','Subject','HTML','Text'),'synthetic-resend-id');
 const call=h.calls[0];assert.equal(call.url,'https://api.resend.com/emails');assert.equal(call.options.headers.Authorization,'Bearer synthetic-resend-key');assert.equal(JSON.parse(call.options.body).from,'Portal <noreply@example.invalid>');
});
test('unknown providers and missing Resend credentials fail without falling back',async()=>{
 for(const settings of [{EMAIL_PROVIDER:'unknown'},{EMAIL_PROVIDER:'resend'},{EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-key'}]){
 const h=harness({settings});await assert.rejects(h.ctx.sendEmail('x@gmail.com','s','h','t'));assert.equal(h.calls.length,0);
 }
});
for(const failure of ['network','http','json','mismatch','RATE_LIMITED','UNAUTHORIZED','CONFIGURATION'])test(`Apps Script failure ${failure} never retries, falls back or exposes diagnostics`,async()=>{
 const h=harness({failure,settings:{RESEND_API_KEY:'unused',EMAIL_FROM:'unused@example.invalid'}});
 await assert.rejects(h.ctx.sendEmail('x@gmail.com','s','h','t'),error=>!error.message.includes('sensitive provider diagnostic'));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,scriptUrl);
});
for(const settings of [{APPS_SCRIPT_EMAIL_URL:undefined},{APPS_SCRIPT_EMAIL_URL:'https://untrusted.invalid/exec'},{APPS_SCRIPT_EMAIL_URL:'https://script.google.com/macros/s/synthetic/dev'},{APPS_SCRIPT_EMAIL_SECRET:'invalid'}])test('invalid Apps Script configuration is rejected before sending',async()=>{
 const h=harness({settings});await assert.rejects(h.ctx.sendEmail('x@gmail.com','s','h','t'));assert.equal(h.calls.length,0);
});
test('Apps Script enforces the deployed UTF-8 message size limit',async()=>{
 const h=harness();await assert.rejects(h.ctx.sendEmail('x@gmail.com','s','✓'.repeat(21000),'t'),/size limit/);assert.equal(h.calls.length,0);
});
for(const role of ['student','officer'])test(`actual ${role} verification and recovery handlers use Apps Script and existing Firebase identity`,async()=>{
 const h=harness({role});h.startEdge();
 const saved=await h.post({action:'save',email:'linked@gmail.com',recovery:true});assert.equal(saved.status,200);assert.equal(h.calls.length,1);
 const first=JSON.parse(Buffer.from(JSON.parse(h.calls[0].options.body).payload,'base64').toString('utf8'));
 const token=/token=([a-f0-9]{64})/.exec(first.text)[1];assert.equal(h.row.verified_email,null);
 const verified=await h.post({action:'verify',token},false);assert.equal(verified.status,200);assert.equal(h.row.verified_email,'linked@gmail.com');assert.equal(h.row.verification_token_hash,null);
 const recovered=await h.post({action:'recover',gmail:'linked@gmail.com'},false);assert.equal(recovered.status,200);assert.equal(h.calls.length,2);
 assert.deepEqual(h.resetIdentities,['001@student.ssu-usc.local']);assert.equal(h.row.account_role,role);assert.equal(h.row.firebase_uid,'synthetic-user');
 assert.ok(h.logs.some(event=>event.kind==='password_recovery'&&event.status==='sent'&&event.providerId.startsWith('apps-script:')));
 const email=JSON.parse(Buffer.from(JSON.parse(h.calls[1].options.body).payload,'base64').toString('utf8'));assert.equal(email.to,'linked@gmail.com');assert.match(email.text,/oobCode=synthetic/);
 await h.post({action:'recover',gmail:'linked@gmail.com'},false);assert.equal(h.calls.length,2,'Existing recovery cooldown remains');
});
test('actual settings endpoint works with Apps Script selected and no Resend secrets',async()=>{
 const h=harness();h.startEdge();const response=await h.post({action:'get'});assert.equal(response.status,200);assert.equal(h.calls.length,0);
});

test('institutional verification callback retains Apps Script delivery and the existing token URL',async()=>{
 const h=harness();h.startEdge();await h.sendInstitutional('student@ssu.edu.ph','b'.repeat(64));
 assert.equal(h.calls.length,1);const payload=JSON.parse(Buffer.from(JSON.parse(h.calls[0].options.body).payload,'base64').toString('utf8'));
 assert.equal(payload.to,'student@ssu.edu.ph');assert.match(payload.text,/verify-institutional.html\?token=b{64}/);assert.equal(payload.kind,'transactional');
});
test('password change security notifications still use Apps Script and audit delivery',async()=>{
 const h=harness();h.startEdge();h.row={firebase_uid:'synthetic-user',requested_email:'linked@gmail.com',verified_email:'linked@gmail.com'};
 const response=await h.post({action:'password_changed'});assert.equal(response.status,200);assert.equal(h.calls.length,1);
 assert.ok(h.logs.some(event=>event.kind==='password_changed'&&event.status==='sent'&&event.providerId.startsWith('apps-script:')));
});
for(const state of ['missing','unverified','disabled'])test(`recovery ${state} Gmail remains private and sends no email`,async()=>{
 const h=harness();h.startEdge();
 if(state!=='missing')h.row={firebase_uid:'synthetic-user',requested_email:'linked@gmail.com',verified_email:state==='unverified'?null:'linked@gmail.com',recovery:state!=='disabled'};
 const response=await h.post({action:'recover',gmail:'linked@gmail.com'},false);
 assert.equal(response.status,200);assert.equal(h.calls.length,0);assert.equal(h.resetIdentities.length,0);
});
test('recovery provider failure records failure without updating send counters or falling back',async()=>{
 const h=harness({failure:'network'});h.startEdge();h.row={firebase_uid:'synthetic-user',requested_email:'linked@gmail.com',verified_email:'linked@gmail.com',recovery:true};
 const response=await h.post({action:'recover',gmail:'linked@gmail.com'},false);
 assert.equal(response.status,200);assert.equal(h.calls.length,1);assert.equal(h.row.recovery_sent_at,undefined);
 assert.ok(h.logs.some(event=>event.kind==='password_recovery'&&event.status==='failed'));
});
