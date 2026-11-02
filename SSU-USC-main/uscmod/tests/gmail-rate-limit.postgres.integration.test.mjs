// Runs only in an explicitly named, labelled, network-isolated disposable database.
import test,{before,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const container=process.env.SSU_TEST_POSTGRES_CONTAINER || '';
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
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
 await sql(fs.readFileSync(new URL('../supabase/gmail-login-rate-limit.sql',import.meta.url),'utf8'));
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
