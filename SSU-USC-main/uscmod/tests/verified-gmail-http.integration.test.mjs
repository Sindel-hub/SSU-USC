// Standalone local contract suite (Node 24+). Never loads process credentials.
// The actual Edge handler and browser service run over loopback with in-memory data.
import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto,createHash} from 'node:crypto';
import {createGmailPasswordAuthenticator} from '../supabase/functions/usc-email/gmail-login.mjs';
import {createInstitutionalAccountService} from '../supabase/functions/usc-email/institutional-accounts.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const stripImports=source=>source.replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/\bexport\s+/g,'');
const compile=source=>stripImports(stripTypeScriptTypes(source));
const token='a'.repeat(64), uid='synthetic-student';
let rows,profile,user,owner,handler,server,base,client,providerCalls,requests,legacyBackend,providerFailure;
function query(){
 const filters=[];let patch;
 const execute=()=>{
  if(providerFailure)return {data:null,error:Error('Synthetic provider failure')};
  const found=rows.filter(row=>filters.every(fn=>fn(row)));
  if(patch)found.forEach(row=>Object.assign(row,patch));
  return {data:found[0]||null,error:null};
 };
 return {
  select(){return this;},eq(key,value){filters.push(row=>row[key]===value);return this;},
  neq(key,value){filters.push(row=>row[key]!==value);return this;},
  update(value){patch=value;return this;},maybeSingle:async()=>execute(),
  then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}
 };
}
function makeClient(){
 const ctx=vm.createContext({URL,auth:{currentUser:null},
  USC_SUPABASE_EMAIL_FUNCTION_URL:'https://synthetic-staging.invalid/functions/v1/usc-email',
  fetch:async(url,options)=>{
   assert.equal(url,'https://synthetic-staging.invalid/functions/v1/usc-email');
   requests.push(JSON.parse(options.body));
   // Only this wrapper can issue requests, and only to our synthetic loopback server.
   return fetch(base+'/functions/v1/usc-email',options);
  },window:{open(){throw Error('No browser navigation expected');}}
 });
 const source=stripImports(read('shared/supabase-email-service.js')).replaceAll('import.meta.url',JSON.stringify(new URL('../shared/supabase-email-service.js',import.meta.url).href));
 vm.runInContext(source,ctx);return ctx;
}
before(async()=>{
 const ctx=vm.createContext({Response,Request,Headers,URL,TextEncoder,Uint8Array,crypto:webcrypto,setTimeout,
  console:{error(){},warn(){}},atob,btoa,
  Deno:{env:{get(name){if(name==='GMAIL_LOGIN_RATE_LIMIT_SECRET')return 'synthetic-test-only-rate-key-123456789';if(name==='GMAIL_LOGIN_TRUSTED_IP_HEADER')return '';throw Error('Production/environment secrets are forbidden in this test');}},serve(fn){handler=fn;}},
  fetch(){throw Error('External network requests are forbidden in this test');},
  createGmailPasswordAuthenticator,createInstitutionalAccountService,
 });
 // Evaluate real helper implementations, then replace only provider adapters.
 vm.runInContext(compile(read('supabase/functions/_shared/usc-email-common.ts')),ctx);
 Object.assign(ctx,{
  adminClient:()=>({from(table){assert.equal(table,'student_email_accounts');return query();},rpc:async(name,args)=>{assert.equal(name,'consume_gmail_login_budget');assert.match(args.p_identity_hash,/^[a-f0-9]{64}$/);return {data:true,error:null};}}),
  firebasePasswordIdentity:async(email,password)=>{providerCalls.push('password-proof');if(email!==user.email||password!=='synthetic-password')throw Error('Invalid credentials');return {uid:user.uid};},
  firestoreGet:async path=>{assert.equal(path,'users/'+uid);providerCalls.push('profile');return profile;},
  firebaseUserByUid:async id=>{providerCalls.push('auth-user');if(id==='unavailable-gmail-login')return null;assert.equal(id,uid);return user;},
  firebaseUserByEmail:async email=>{providerCalls.push('auth-owner');return owner;},
  env:()=>({portalUrl:'https://synthetic-staging.invalid'}),
 });
 vm.runInContext(compile(read('supabase/functions/usc-email/index.ts')),ctx);
 server=http.createServer(async(req,res)=>{
  try {
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=Buffer.concat(chunks);
   const request=new Request(base+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{} )});
   const response=legacyBackend?new Response(JSON.stringify({ok:false,message:'Unknown email-service action.'}),{status:400}):await handler(request);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch(error){res.writeHead(500);res.end(JSON.stringify({ok:false,message:error.message}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});
beforeEach(()=>{
 providerCalls=[];requests=[];owner=null;legacyBackend=false;providerFailure=false;
 profile={uid,role:'student',schoolProvisioned:true,accountStatus:'approved',isActive:true,studentStanding:'active'};
 user={uid,email:'001234@student.ssu-usc.local',disabled:false};
 rows=[{firebase_uid:uid,requested_email:'personal@gmail.com',verified_email:null,verified_at:null,
  verification_token_hash:createHash('sha256').update(token).digest('hex'),verification_expires_at:new Date(Date.now()+3600000).toISOString()}];
 client=makeClient();
});
async function post(body){return fetch(base+'/functions/v1/usc-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function verify(){const response=await post({action:'verify',token});assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.ok,true);}

test('actual verification handler enables frontend lookup of the same Firebase UID over HTTP',async()=>{
 await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'),/Unable to sign in/);
 await verify();
 const result=await client.authenticateVerifiedGmailLogin('P.er.sonal+alerts@gmail.com','synthetic-password');
 assert.equal(result.uid,uid);assert.equal(result.authEmail,user.email);
 assert.equal(rows.length,1);assert.equal(profile.role,'student');assert.equal(user.email,'001234@student.ssu-usc.local');
 assert.equal(rows[0].verification_token_hash,null);
 assert.ok(requests.every(request=>request.password==='synthetic-password'));
});
test('expired verification cannot enable Gmail lookup',async()=>{
 rows[0].verification_expires_at=new Date(Date.now()-1).toISOString();
 assert.equal((await post({action:'verify',token})).status,410);
 await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'),/Unable to sign in/);
});
test('changed and removed Gmail records revoke lookup without stale persisted aliases',async()=>{
 await verify();await client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password');
 rows[0].requested_email='changed@gmail.com';await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'));
 rows=[];await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'));
});
test('duplicate ownership is rejected by actual resolver adapter',async()=>{
 await verify();owner={uid:'different-firebase-owner'};
 await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'));
});
test('inactive school profile is rejected using the real active-profile helper',async()=>{
 await verify();profile.studentStanding='withdrawn';await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'));
});
test('disabled Firebase account is rejected over HTTP',async()=>{
 await verify();user.disabled=true;await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'));
});
test('metadata is password-gated, retired lookup is closed and responses are no-store',async()=>{
 await verify();
 const retired=await post({action:'resolve_gmail_login',email:'personal@gmail.com'});
 assert.equal(retired.status,401);assert.equal((await retired.json()).uid,undefined);
 const response=await post({action:'authenticate_gmail',email:'personal@gmail.com',password:'synthetic-password'});
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
 const payload=await response.json();assert.deepEqual(Object.keys(payload).sort(),['authEmail','ok','protocol','uid']);
 assert.equal(payload.idToken,undefined);assert.equal(payload.refreshToken,undefined);
});
test('older backend fails closed in the current frontend rather than pretending Gmail is enabled',async()=>{
 legacyBackend=true;await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'),/Unknown email-service action/);
 assert.equal(providerCalls.length,0);
});
test('provider failure is propagated as a failed request and grants no lookup result',async()=>{
 providerFailure=true;
 const response=await post({action:'authenticate_gmail',email:'personal@gmail.com',password:'synthetic-password'});
 assert.equal(response.status,401);
 const payload=await response.json();assert.equal(payload.ok,false);assert.equal(payload.uid,undefined);
 await assert.rejects(client.authenticateVerifiedGmailLogin('personal@gmail.com','synthetic-password'),/Unable to sign in/);
});
test('HTTP OPTIONS contract supports cross-origin browser requests without an authentication session',async()=>{
 const response=await fetch(base+'/functions/v1/usc-email',{method:'OPTIONS'});
 assert.equal(response.status,200);assert.match(response.headers.get('Access-Control-Allow-Methods'),/POST/);
 assert.match(response.headers.get('Access-Control-Allow-Headers'),/content-type/);
});
