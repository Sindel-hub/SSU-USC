import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/security-client.js', import.meta.url), 'utf8');
const manage = source.slice(source.indexOf('async function browserManageCandidate('), source.indexOf('async function browserReviewCandidate('));
function harness({started = false, completed = false, denied = false, auditFails = false} = {}) {
  const candidate = {candidateId:'one', fullName:'Original',position:'President',department:'Arts',approved:true};
  const records = new Map([
    ['elections/e', {votingStart:started || completed ? 1 : Date.now()+60000, votingEnd:completed ? 2 : Date.now()+120000}],
    ['elections/e/candidates/one',candidate],
    ['elections/e/candidates/two',{fullName:'Other',approved:true}],
    ['elections/e/ballots/b',{selections:{President:'one'}}],
    ['elections/e/results/official',{results:[{candidateId:'one',fullName:'Official',votes:1}]}]
  ]);
  let sequence = 0;
  const ref = (path) => ({path,id:path.split('/').at(-1)});
  const ctx = vm.createContext({
    db:{}, Date, ELECTION_POSITIONS:['President','Vice President'],
    requireBrowserPermission:async (permission) => {assert.equal(permission,'elections.review'); if (denied) throw Error('denied'); return {user:{uid:'officer'}};},
    toMillis:(v)=>v, serverTimestamp:()=>123,
    collection:(_db,...parts)=>ref(parts.join('/')),
    doc:(first,...parts)=>first.path ? ref(`${first.path}/audit-${++sequence}`) : ref(parts.join('/')),
    runTransaction:async (_db,fn)=>{
      const changes=[];
      await fn({
        get:async (r)=>({exists:()=>records.has(r.path), data:()=>records.get(r.path)}),
        update:(r,data)=>changes.push([r.path,{...records.get(r.path),...data}]),
        set:(r,data)=>{if(auditFails) throw Error('audit unavailable');changes.push([r.path,data]);}
      });
      for (const [path,data] of changes) records.set(path,data);
    }
  });
  vm.runInContext(manage,ctx);
  return {records,run:(details={},remove=false)=>ctx.browserManageCandidate({electionId:'e',candidateId:'one',details},remove)};
}

test('profile edits only affect selected candidate and append actor, time, before/after audit',async()=>{
  const h=harness();
  await h.run({fullName:'Updated',position:'Vice President',campaignPhotoUrl:'https://example.test/photo.png'});
  assert.equal(h.records.get('elections/e/candidates/one').fullName,'Updated');
  assert.equal(h.records.get('elections/e/candidates/two').fullName,'Other');
  const audit=h.records.get('audit_logs/audit-1');
  assert.equal(audit.actorUid,'officer'); assert.equal(audit.createdAt,123);
  assert.equal(audit.before.fullName,'Original'); assert.equal(audit.after.fullName,'Updated');
  assert.equal(audit.action,'CANDIDATE_EDIT');
});
for (const started of [false,true]) test(`removal preserves candidates, ballots and official results (${started ? 'during/after voting' : 'scheduled'})`, async()=>{
  const h=harness({started});
  const before=JSON.stringify([...h.records].filter(([p])=>!p.endsWith('/one')));
  await h.run({},true);
  assert.equal(h.records.get('elections/e/candidates/one').removed,true);
  assert.equal(JSON.stringify([...h.records].filter(([p])=>!p.endsWith('/one')&&!p.startsWith('audit_logs/'))),before);
  assert.equal(h.records.get('audit_logs/audit-1').action,'CANDIDATE_REMOVE');
});
test('post-voting edits retain original result identity across subsequent edits',async()=>{
  const h=harness({started:true});
  await h.run({fullName:'New name'}); await h.run({fullName:'Another name'});
  assert.equal(h.records.get('elections/e/candidates/one').resultIdentity.fullName,'Original');
  await assert.rejects(h.run({position:'Vice President'}),/fixed while voting is active/);
});
test('permission denial or audit failure leaves candidate unchanged',async()=>{
  for (const opts of [{denied:true},{auditFails:true}]) {
    const h=harness(opts); await assert.rejects(h.run({fullName:'Changed'}));
    assert.equal(h.records.get('elections/e/candidates/one').fullName,'Original');
  }
});
test('invalid photo URLs and names are rejected without writes',async()=>{
  const h=harness();
  await assert.rejects(h.run({campaignPhotoUrl:'javascript:alert(1)'}),/HTTPS/);
  await assert.rejects(h.run({fullName:''}),/name/);
  assert.equal(h.records.get('elections/e/candidates/one').fullName,'Original');
});

test('completed election profiles can change position without changing historical identity',async()=>{
  const h=harness({completed:true});
  await h.run({position:'Vice President',department:'Science'});
  const candidate=h.records.get('elections/e/candidates/one');
  assert.equal(candidate.position,'Vice President');
  assert.equal(candidate.resultIdentity.position,'President');
  assert.equal(h.records.get('elections/e/results/official').results[0].votes,1);
});

test('publication includes removed candidates and uses their historical identity and votes',async()=>{
  let official;
  const row={approved:true,removed:true,fullName:'Edited',position:'Vice President',resultIdentity:{fullName:'Original',position:'President'}};
  const ctx=vm.createContext({
    db:{}, Date,
    requireBrowserPermission:async()=>({user:{uid:'officer'},role:'admin',profile:{}}),
    browserElectionContext:async()=>({electionId:'e',finalized:true,resultPublicationStart:1}),
    serverTimestamp:()=>123,
    doc:(_db,...parts)=>({path:parts.join('/')}),
    collection:(_db,...parts)=>({path:parts.join('/')}),
    getDoc:async()=>({exists:()=>false}),
    getDocs:async(ref)=>ref.path.endsWith('candidates') ? {docs:[{id:'one',data:()=>row}]} : {size:1,forEach:(fn)=>fn({data:()=>({selections:{President:'one'}})})},
    writeBatch:()=>({set:(_ref,data)=>{official=data;},update:()=>{},commit:async()=>{}})
  });
  const code=source.slice(source.indexOf('async function browserPublishResults('),source.indexOf('async function browserArchiveElection('));
  vm.runInContext(code,ctx);
  await ctx.browserPublishResults();
  assert.equal(official.results.length,1);
  assert.equal(official.results[0].votes,1);
  assert.equal(official.results[0].fullName,'Original');
  assert.equal(official.results[0].position,'President');
});
