import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/security-client.js', import.meta.url), 'utf8');
const manage = source.slice(source.indexOf('async function browserManageCandidate('), source.indexOf('async function browserReviewCandidate('));
function harness({started = false, completed = false, denied = false, auditFails = false, permissions = ["elections.review"]} = {}) {
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
    requireBrowserRole:async()=>{if(denied)throw Error('denied');return {user:{uid:'officer'},profile:{},role:'officer'};},
    browserHasOfficerPermission:(_profile,_role,permission)=>permissions.includes(permission),
    toMillis:(v)=>v, serverTimestamp:()=>123,
    collection:(_db,...parts)=>ref(parts.join('/')),
    doc:(first,...parts)=>first.path ? ref(`${first.path}/audit-${++sequence}`) : ref(parts.join('/')),
    where:(field,op,value)=>({field,value}),query:(reference,...filters)=>({...reference,filters}),
    getDocs:async reference=>({docs:[...records].filter(([path,data])=>path.startsWith(reference.path+'/') && path.slice(reference.path.length+1).indexOf('/')<0 && reference.filters.every(f=>data[f.field]===f.value)).map(([path])=>({ref:ref(path)}))}),
    runTransaction:async (_db,fn)=>{
      const changes=[];
      await fn({
        get:async (r)=>({exists:()=>records.has(r.path), data:()=>records.get(r.path)}),
        delete:r=>changes.push([r.path,null]),
        update:(r,data)=>changes.push([r.path,{...records.get(r.path),...data}]),
        set:(r,data)=>{if(auditFails) throw Error('audit unavailable');changes.push([r.path,data]);}
      });
      for (const [path,data] of changes) data===null?records.delete(path):records.set(path,data);
    }
  });
  vm.runInContext(source.slice(source.indexOf("async function requireBrowserPermission("),source.indexOf("function timestampFromInput(")),ctx);
  vm.runInContext(manage,ctx);
  return {records,run:(details={},remove=false,dismiss=false)=>ctx.browserManageCandidate({electionId:'e',candidateId:'one',details},remove,dismiss)};
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

const officerSource=fs.readFileSync(new URL('../usc-admin/elections/js/elections.js',import.meta.url),'utf8');
function officerHarness({authorized=true,removeAuthorized=authorized,removed=false,managementHidden=false,confirmRemoval=true}={}){
  const calls=[],confirmations=[];
  const decisions=Array.isArray(confirmRemoval)?[...confirmRemoval]:null;
  const application={id:'applicant',candidateId:'candidate',status:'Approved',fullName:'Approved Student',position:'President'};
  const candidate={id:'candidate',approved:true,removed,managementHidden,fullName:application.fullName};
  const list={innerHTML:'',querySelectorAll:()=>[]};
  const ctx=vm.createContext({applications:[application],candidates:[candidate],canManageCandidates:authorized,canRemoveCandidates:removeAuthorized,
    context:{reviewOpen:false,lifecycle:'Archived'},electionId:'e',els:{candidateReviewList:list},
    clean:v=>String(v??'').trim(),esc:v=>String(v??''),confirm:(message)=>{confirmations.push(message);return decisions?decisions.shift():confirmRemoval;},
    hydrateCandidatePreviewImages:async()=>{},closeCandidatePreview:()=>{},refreshAll:async()=>{},alert:()=>{},
    callSecure:async(name,data)=>{calls.push({name,data});}
  });
  vm.runInContext(officerSource.slice(officerSource.indexOf('async function removeCandidateApplication('),officerSource.indexOf('function openCandidateEditor(')),ctx);
  vm.runInContext(officerSource.slice(officerSource.indexOf('function renderApplications('),officerSource.indexOf('function schedulePayload(')),ctx);
  return {ctx,list,calls,application,confirmations};
}
test('approved application cards expose Remove outside the review window',()=>{
  const h=officerHarness();h.ctx.renderApplications();assert.match(h.list.innerHTML,/data-remove-approved-candidate="applicant"/);
});
test('read-only officers cannot remove approved candidates',async()=>{
  const h=officerHarness({authorized:false});h.ctx.renderApplications();assert.doesNotMatch(h.list.innerHTML,/data-remove-approved-candidate/);
  await h.ctx.removeCandidateApplication(h.application);assert.equal(h.calls.length,0);
});
test('approved removal uses the candidate soft-removal endpoint, never application deletion',async()=>{
  const h=officerHarness();await h.ctx.removeCandidateApplication(h.application);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'removeElectionCandidate');assert.equal(h.calls[0].data.candidateId,'candidate');
  assert.equal(h.application.status,'Approved');
});
test('cancelled confirmation preserves the approved candidate',async()=>{
  const h=officerHarness({confirmRemoval:false});await h.ctx.removeCandidateApplication(h.application);assert.equal(h.calls.length,0);
});
test('removed approved candidates show historical status without a second Remove action',async()=>{
  const h=officerHarness({removed:true});h.ctx.renderApplications();assert.match(h.list.innerHTML,/Candidate removed/);
  assert.doesNotMatch(h.list.innerHTML,/data-remove-approved-candidate/);assert.equal(h.application.status,'Approved');
  await h.ctx.removeCandidateApplication(h.application);assert.equal(h.calls.length,0);
});

test('module-assigned officers can remove approved candidates without review permission',async()=>{
  const h=harness({permissions:['elections.view'],completed:true});await h.run({},true);
  assert.equal(h.records.get('elections/e/candidates/one').removed,true);
  assert.equal(h.records.get('audit_logs/audit-1').action,'CANDIDATE_REMOVE');
  assert.equal(h.records.get('audit_logs/audit-1').electionId,'e');
  assert.equal(h.records.get('elections/e/results/official').results[0].votes,1);
});
test('module removal permission does not grant candidate profile editing',async()=>{
  const h=harness({permissions:['elections.view']});await assert.rejects(h.run({fullName:'Unauthorized edit'}),/permission/);
  assert.equal(h.records.get('elections/e/candidates/one').fullName,'Original');
});
test('officers without election permissions cannot remove candidates',async()=>{
  const h=harness({permissions:[]});await assert.rejects(h.run({},true),/permission/);
  assert.equal(h.records.get('elections/e/candidates/one').removed,undefined);
});
test('module-assigned officers see the approved-card removal action and use the soft-removal endpoint',async()=>{
  const h=officerHarness({authorized:false,removeAuthorized:true});h.ctx.renderApplications();
  assert.match(h.list.innerHTML,/data-remove-approved-candidate="applicant"/);
  await h.ctx.removeCandidateApplication(h.application);assert.equal(h.calls[0].name,'removeElectionCandidate');
});
test('cloud permission helper accepts either module access or existing review access',async()=>{
  const cloud=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
  const helper=cloud.slice(cloud.indexOf('async function requireOfficerPermission('),cloud.indexOf('function requireRecentAuth('));
  for(const permissions of [['elections.view'],['elections.review'],[]]){
    const ctx=vm.createContext({requireActiveRole:async()=>({}),roleOf:()=> 'officer',effectiveOfficerPermissionList:()=>permissions,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}});
    vm.runInContext(helper,ctx);
    if(permissions.length)await ctx.requireOfficerPermission({},['elections.view','elections.review']);
    else await assert.rejects(ctx.requireOfficerPermission({},['elections.view','elections.review']));
  }
});

test('candidate management panel is removed and actions remain in candidate review',()=>{
  assert.doesNotMatch(officerSource,/candidateManagementCard|renderCandidateManagement/);
  const h=officerHarness();h.ctx.renderApplications();
  assert.match(h.list.innerHTML,/data-remove-approved-candidate="applicant"/);
  assert.match(h.list.innerHTML,/data-edit-reviewed-candidate="candidate"/);
});
test('module-only officers can remove from review without gaining edit controls',()=>{
  const h=officerHarness({authorized:false,removeAuthorized:true});h.ctx.renderApplications();
  assert.match(h.list.innerHTML,/data-remove-approved-candidate/);assert.doesNotMatch(h.list.innerHTML,/data-edit-reviewed-candidate/);
});
test('historically removed candidates do not expose edit controls in review',()=>{
  const h=officerHarness({removed:true});h.ctx.renderApplications();assert.doesNotMatch(h.list.innerHTML,/data-edit-reviewed-candidate/);
});

test('cancelling the final confirmation prevents the removal write',async()=>{
  const h=officerHarness({confirmRemoval:[true,false]});await h.ctx.removeCandidateApplication(h.application);
  assert.equal(h.calls.length,0);assert.equal(h.confirmations.length,2);
  assert.match(h.confirmations[1],/absolutely sure/);assert.match(h.confirmations[1],/Approved Student/);
  assert.match(h.confirmations[1],/Student Dashboard/);
});
test('both confirmations name the candidate and are required before removal',async()=>{
  const h=officerHarness({confirmRemoval:[true,true]});await h.ctx.removeCandidateApplication(h.application);
  assert.equal(h.calls.length,1);assert.equal(h.confirmations.length,2);
  assert.ok(h.confirmations.every(message=>message.includes('Approved Student')));
});

test('pending application removal also requires final confirmation',async()=>{
  const h=officerHarness({confirmRemoval:[true,false]});h.application.status='Under Review';h.application.candidateId='';
  await h.ctx.removeCandidateApplication(h.application);assert.equal(h.confirmations.length,2);assert.equal(h.calls.length,0);
});

 test('dismissal requires prior removal and preserves historical records with its own audit',async()=>{
 const h=harness({completed:true,permissions:['elections.view']});
 await assert.rejects(h.run({},false,true),/Remove the candidate/);
 await h.run({},true);
 const before=h.records.get('elections/e/candidates/one');
 await h.run({},false,true);
 const after=h.records.get('elections/e/candidates/one');
 assert.equal(after.managementHidden,true);assert.equal(after.removed,true);
 assert.equal(after.resultIdentity,before.resultIdentity);
 assert.equal(h.records.get('elections/e/results/official').results[0].votes,1);
 assert.equal(h.records.get('elections/e/ballots/b').selections.President,'one');
 assert.equal(h.records.get('elections/e/candidates/two').fullName,'Other');
 assert.equal([...h.records.values()].filter(v=>v.action==='CANDIDATE_DISMISS').length,1);
 await h.run({},false,true);
 assert.equal([...h.records.values()].filter(v=>v.action==='CANDIDATE_DISMISS').length,1);
 });
 test('dismissal audit failure leaves removed card visible',async()=>{
 const h=harness({auditFails:true});h.records.get('elections/e/candidates/one').removed=true;
 await assert.rejects(h.run({},false,true),/audit unavailable/);
 assert.equal(h.records.get('elections/e/candidates/one').managementHidden,undefined);
 });
 test('removed cards expose confirmed Delete from Review to module officers',async()=>{
 const h=officerHarness({authorized:false,removeAuthorized:true,removed:true});h.ctx.renderApplications();
 assert.match(h.list.innerHTML,/data-delete-removed-candidate="candidate"/);
 await h.ctx.deleteRemovedCandidate(h.ctx.candidates[0]);
 assert.equal(h.calls[0].name,'dismissElectionCandidate');assert.match(h.confirmations[0],/Approved Student/);
 assert.match(h.confirmations[0],/retained/);
 });
 test('active, unauthorized and cancelled cards cannot be dismissed',async()=>{
 for(const opts of [{},{removed:true,authorized:false},{removed:true,confirmRemoval:false}]){
 const h=officerHarness(opts);await h.ctx.deleteRemovedCandidate(h.ctx.candidates[0]);assert.equal(h.calls.length,0);
 }
 });
 test('dismissed removed cards disappear without deleting the application',()=>{
 const h=officerHarness({removed:true,managementHidden:true});h.ctx.renderApplications();
 assert.doesNotMatch(h.list.innerHTML,/Approved Student|data-delete-removed-candidate/);
 assert.equal(h.ctx.applications.length,1);assert.equal(h.application.status,'Approved');
 });
