// Runs only in an explicitly named, labelled, network-isolated disposable database.
import test,{before,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createGmailPasswordAuthenticator} from '../supabase/functions/usc-email/gmail-login.mjs';
const container=process.env.SSU_TEST_POSTGRES_CONTAINER || '';
const env={...process.env};for(const key of ['SUPABASE_ACCESS_TOKEN','GH_TOKEN','GITHUB_TOKEN','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
function docker(args,input=''){
 return new Promise((resolve,reject)=>{
  const proc=spawn('docker',['--host=unix:///var/run/docker.sock',...args],{env});let stdout='',stderr='';
  proc.stdout.on('data',data=>stdout+=data);proc.stderr.on('data',data=>stderr+=data);proc.on('error',reject);
  proc.on('close',code=>resolve({code,stdout:stdout.trim(),stderr:stderr.trim()}));proc.stdin.end(input);
 });
}
async function sql(query,{expectFailure=false}={}){
 const result=await docker(['exec','-i',container,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],query);
 if(expectFailure)assert.notEqual(result.code,0);else assert.equal(result.code,0,result.stderr);
 return result;
}
const identity='a'.repeat(64),client='b'.repeat(64);
const consume=(id=identity,ip=null)=>sql(`set role service_role;select public.consume_gmail_login_budget('${id}',${ip?"'"+ip+"'":'null'});`);
before(async()=>{
 assert.match(container,/^ssu-local-[a-z0-9-]+$/,'Use a disposable SSU local test container, never a remote database.');
 const inspection=await docker(['inspect','--format','{{.HostConfig.NetworkMode}} {{index .Config.Labels "com.ssu.test"}}',container]);
 assert.equal(inspection.stdout,'none gmail-rate');
 await sql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if; end $$;`);
 await sql('alter role service_role bypassrls;');
 const migration=fs.readFileSync(new URL('../supabase/migrations/202611030001_gmail_login_rate_limit.sql',import.meta.url),'utf8');
 assert.equal(migration,fs.readFileSync(new URL('../supabase/gmail-login-rate-limit.sql',import.meta.url),'utf8'));
 await sql('BEGIN;'+migration+'COMMIT;');
});
beforeEach(async()=>{
 await sql('truncate public.gmail_login_rate_limits;');
 // Avoid splitting the small parallel-connection check across a minute boundary.
 const second=Number((await sql('select extract(second from clock_timestamp());')).stdout);
 if(second>56)await new Promise(resolve=>setTimeout(resolve,(61-second)*1000));
});
test('independent concurrent callers share the five-attempt identity budget',async()=>{
 const results=await Promise.all(Array.from({length:20},()=>consume()));
 assert.equal(results.filter(result=>result.stdout==='t').length,5);
 assert.equal(results.filter(result=>result.stdout==='f').length,15);
});
test('independent identities share the twenty-attempt trusted-client budget',async()=>{
 const results=await Promise.all(Array.from({length:30},(_,i)=>consume(i.toString(16).padStart(64,'0'),client)));
 assert.equal(results.filter(result=>result.stdout==='t').length,20);
});
test('global budget bounds rotating identifiers and avoids unbounded key creation after denial',async()=>{
 const result=await sql("set role service_role;select public.consume_gmail_login_budget(lpad(to_hex(i),64,'0'),null) from generate_series(1,150) as i;");
 assert.equal(result.stdout.split('\n').filter(line=>line==='t').length,120);
 assert.equal(result.stdout.split('\n').filter(line=>line==='f').length,30);
 assert.equal(Number((await sql('select count(*) from public.gmail_login_rate_limits;')).stdout),121);
});
test('database window reset and cleanup use database time',async()=>{
 await consume();
 await sql("update public.gmail_login_rate_limits set window_start=clock_timestamp()-interval '1 minute',attempts=121;");
 assert.equal((await consume()).stdout,'t');
 await sql("update public.gmail_login_rate_limits set expires_at=clock_timestamp()-interval '1 second';");
 assert.equal((await consume()).stdout,'t');
 assert.equal((await sql("select max(attempts) from public.gmail_login_rate_limits;")).stdout,'1');
});
test('anonymous and authenticated browser roles cannot call the limiter or read its records',async()=>{
 for(const role of ['anon','authenticated']){
  await sql(`set role ${role};select * from public.gmail_login_rate_limits;`,{expectFailure:true});
  await sql(`set role ${role};select public.consume_gmail_login_budget('${identity}',null);`,{expectFailure:true});
 }
});
test('malformed keys cannot create records; accepted records store hashes without raw identifiers',async()=>{
 await sql("set role service_role;select public.consume_gmail_login_budget('personal@gmail.com',null);",{expectFailure:true});
 assert.equal((await sql('select count(*) from public.gmail_login_rate_limits;')).stdout,'0');
 await consume(identity,client);
 const keys=(await sql('select bucket_key from public.gmail_login_rate_limits order by bucket_key;')).stdout;
 assert.equal(keys.includes('@'),false);assert.equal(keys.includes('127.0.0.1'),false);
 assert.match(keys,/identity:[a-f0-9]{64}/);assert.match(keys,/client:[a-f0-9]{64}/);
});

test('least privilege: only service RPC execution; definer owner, fixed path and RLS verified',async()=>{
 const config=(await sql("select prosecdef,pg_get_userbyid(proowner),array_to_string(proconfig,',') from pg_proc where oid='public.consume_gmail_login_budget(text,text)'::regprocedure;")).stdout;
 assert.equal(config,'t|postgres|search_path=pg_catalog');
 assert.equal((await sql("select relrowsecurity from pg_class where oid='public.gmail_login_rate_limits'::regclass;")).stdout,'t');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await sql(`select has_table_privilege('${role}','public.gmail_login_rate_limits','SELECT,INSERT,UPDATE,DELETE');`)).stdout,'f');
  await sql(`set role ${role};insert into public.gmail_login_rate_limits values('global',now(),1,now());`,{expectFailure:true});
 }
 assert.equal((await consume()).stdout,'t');
});
test('reapplying the migration preserves counters and unrelated records',async()=>{
 await consume();await sql("create table if not exists public.synthetic_existing_record(id integer primary key,value text);insert into public.synthetic_existing_record values(1,'preserved') on conflict do nothing;");
 const migration=fs.readFileSync(new URL('../supabase/migrations/202611030001_gmail_login_rate_limit.sql',import.meta.url),'utf8');
 await sql('BEGIN;'+migration+'COMMIT;');
 assert.equal((await sql("select attempts from public.gmail_login_rate_limits where bucket_key='identity:"+identity+"';")).stdout,'1');
 assert.equal((await sql('select value from public.synthetic_existing_record where id=1;')).stdout,'preserved');
});
test('untrusted search paths cannot redirect counter writes',async()=>{
 await sql("create schema if not exists synthetic_hostile;create table if not exists synthetic_hostile.gmail_login_rate_limits as select * from public.gmail_login_rate_limits with no data;grant usage on schema synthetic_hostile to service_role;");
 assert.equal((await sql(`set role service_role;set search_path=synthetic_hostile,public;select public.consume_gmail_login_budget('${identity}',null);`)).stdout,'t');
 assert.equal((await sql('select count(*) from synthetic_hostile.gmail_login_rate_limits;')).stdout,'0');
});
test('invalid credentials consume shared DB budget; exhaustion stops password checks',async()=>{
 let proofs=0;
 const authenticate=createGmailPasswordAuthenticator({canonicalGmail:()=> 'synthetic@gmail.com',consumeBudget:async()=> (await consume()).stdout==='t',finishDelay:async()=>{},verifiedAccount:async()=>({firebase_uid:'synthetic',requested_email:'synthetic@gmail.com',verified_email:'synthetic@gmail.com',verified_at:'synthetic'}),authUser:async()=>({uid:'synthetic',email:'001@student.ssu-usc.local'}),passwordIdentity:async()=>{proofs++;throw Error('wrong password');}});
 for(let i=0;i<5;i++)assert.equal((await authenticate({email:'synthetic@gmail.com',password:'incorrect'})).status,401);
 assert.equal((await authenticate({email:'synthetic@gmail.com',password:'incorrect'})).status,429);assert.equal(proofs,5);
});
test('simultaneous Edge authenticators cannot exceed a shared identity budget',async()=>{
 let proofs=0;const deps={authByEmail:async()=>null,canonicalGmail:()=> 'synthetic@gmail.com',consumeBudget:async()=> (await consume()).stdout==='t',finishDelay:async()=>{},verifiedAccount:async()=>null,authUser:async()=>null,passwordIdentity:async()=>{proofs++;throw Error('invalid');}};
 const results=await Promise.all(Array.from({length:15},()=>createGmailPasswordAuthenticator(deps)({email:'synthetic@gmail.com',password:'incorrect'})));
 assert.equal(results.filter(r=>r.status===401).length,5);assert.equal(results.filter(r=>r.status===429).length,10);assert.equal(proofs,5);
});
test('successful verified Gmail password login still uses existing UID and consumes one budget',async()=>{
 const deps={authByEmail:async()=>null,canonicalGmail:()=> 'synthetic@gmail.com',consumeBudget:async()=> (await consume()).stdout==='t',finishDelay:async()=>{},verifiedAccount:async()=>({firebase_uid:'synthetic',requested_email:'synthetic@gmail.com',verified_email:'synthetic@gmail.com',verified_at:'synthetic'}),authUser:async()=>({uid:'synthetic',email:'001@student.ssu-usc.local'}),passwordIdentity:async()=>({uid:'synthetic'}),profile:async()=>({role:'student'}),activeProfile:()=>true,authByEmail:async()=>null};
 const result=await createGmailPasswordAuthenticator(deps)({email:'synthetic@gmail.com',password:'correct-synthetic-password'});
 assert.equal(result.status,200);assert.equal(result.body.uid,'synthetic');assert.equal(result.body.authEmail,'001@student.ssu-usc.local');
 assert.equal((await sql("select attempts from public.gmail_login_rate_limits where bucket_key='identity:"+identity+"';")).stdout,'1');
});
test('optional rollback removes only new limiter objects and supports clean reapplication',async()=>{
 await sql("create table if not exists public.synthetic_existing_record(id integer primary key,value text);insert into public.synthetic_existing_record values(1,'preserved') on conflict do nothing;");
 await consume();
 const rollback=fs.readFileSync(new URL('../supabase/rollback/202611030001_gmail_login_rate_limit.sql',import.meta.url),'utf8');
 await sql('BEGIN;'+rollback+'COMMIT;');
 assert.equal((await sql("select to_regprocedure('public.consume_gmail_login_budget(text,text)') is null,to_regclass('public.gmail_login_rate_limits') is null;")).stdout,'t|t');
 assert.equal((await sql('select value from public.synthetic_existing_record where id=1;')).stdout,'preserved');
 const migration=fs.readFileSync(new URL('../supabase/migrations/202611030001_gmail_login_rate_limit.sql',import.meta.url),'utf8');
 await sql('BEGIN;'+migration+'COMMIT;');assert.equal((await consume()).stdout,'t');
});
test('null, noncanonical and malformed client hashes cannot allocate any counters',async()=>{
 for(const key of [null,'a'.repeat(63),'A'.repeat(64),'a'.repeat(65),'not-a-hash']){
  const literal=key===null?'null':"'"+key+"'";
  await sql(`set role service_role;select public.consume_gmail_login_budget(${literal},null);`,{expectFailure:true});
 }
 await sql(`set role service_role;select public.consume_gmail_login_budget('${identity}','not-a-client-hash');`,{expectFailure:true});
 assert.equal((await sql('select count(*) from public.gmail_login_rate_limits;')).stdout,'0');
});
