import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {extendVotingSchedule} from '../shared/election-extension.js';
const fields=['registrationStart','registrationEnd','applicationReviewStart','applicationReviewEnd','candidatePublicationStart','candidatePublicationEnd','votingStart','votingEnd','resultPublicationStart','resultPublicationEnd'];
const at=hours=>new Date(Date.UTC(2026,10,2,hours)).toISOString();
const schedule={registrationStart:at(0),registrationEnd:at(1),applicationReviewStart:at(1),applicationReviewEnd:at(2),candidatePublicationStart:at(2),candidatePublicationEnd:at(10),votingStart:at(3),votingEnd:at(5),resultPublicationStart:at(6),resultPublicationEnd:at(8)};
test('voting can be extended without changing other phases when results do not overlap',()=>{
 const next=extendVotingSchedule({...schedule,votingEnd:at(6)},schedule.votingEnd);
 assert.equal(next.votingEnd,at(6));for(const field of fields.filter(f=>f!=='votingEnd'))assert.equal(next[field],schedule[field]);
});
test('overlapping results move later with their duration preserved',()=>{
 const next=extendVotingSchedule({...schedule,votingEnd:at(9)},schedule.votingEnd);
 assert.equal(next.resultPublicationStart,at(9));assert.equal(next.resultPublicationEnd,at(11));assert.equal(next.votingStart,schedule.votingStart);
 assert.equal(schedule.resultPublicationStart,at(6));
});
test('extension rejects shorter, unchanged or malformed closing times',()=>{
 for(const value of [at(4),at(5),'bad'])assert.throws(()=>extendVotingSchedule({...schedule,votingEnd:value},schedule.votingEnd));
});
class Stamp{constructor(ms){this.ms=ms;}toMillis(){return this.ms;}}
const source=fs.readFileSync(new URL('../shared/security-client.js',import.meta.url),'utf8');
function browser({flags={},denied=false,auditFails=false,retryFinalization=false}={}){
 const before={electionId:'usc-test',title:'Election',candidateReviewComplete:true,scheduleVersion:4,finalized:false,resultsPublished:false,archived:false,...Object.fromEntries(fields.map(field=>[field,new Stamp(Date.parse(schedule[field]))])),...flags};
 const records=new Map([['elections/usc-test',before],['election_config/current',{electionId:'usc-test'}],['elections/usc-test/ballots/one',{selections:{President:'candidate'}}],['elections/usc-test/candidates/candidate',{fullName:'Original'}],['elections/usc-test/turnout/public',{ballotsCast:7}]]);
 let seq=0;
 const ref=path=>({path,id:path.split('/').at(-1)});
 const ctx=vm.createContext({db:{},ELECTION_SCHEDULE_FIELDS:fields,
  requireBrowserPermission:async permission=>{assert.equal(permission,'elections.view');if(denied)throw Error('denied');return {user:{uid:'officer',email:'officer@example.invalid'}};},
  timestampFromInput:value=>{const ms=Date.parse(value);if(!Number.isFinite(ms))throw Error('invalid date');return new Stamp(ms);},
  lifecycleFromSchedule:()=> 'Voting',serverTimestamp:()=>123,
  doc:(first,...parts)=>first.path?ref(first.path+'/log-'+(++seq)):ref(parts.join('/')),
  collection:(_db,...parts)=>ref(parts.join('/')),
  runTransaction:async(_db,fn)=>{
   async function attempt(commit){
    const writes=[];
    const result=await fn({get:async reference=>({exists:()=>records.has(reference.path),data:()=>records.get(reference.path)}),set:(reference,data,options)=>{if(auditFails&&reference.path.startsWith('audit_logs/'))throw Error('audit failed');writes.push([reference.path,options?.merge?{...records.get(reference.path),...data}:data]);}});
    if(commit)for(const [path,value] of writes)records.set(path,value);return result;
   }
   if(retryFinalization){await attempt(false);records.set('elections/usc-test',{...before,finalized:true});}
   return attempt(true);
  }
 });
 vm.runInContext(source.slice(source.indexOf('function normalizedSchedule('),source.indexOf('function bytesToBase64(')),ctx);
 vm.runInContext(source.slice(source.indexOf('async function browserSaveElectionSchedule('),source.indexOf('async function browserDeleteElectionSchedule(')),ctx);
 return {records,run:extra=>ctx.browserSaveElectionSchedule({electionId:'usc-test',title:'Election',schedule:extendVotingSchedule({...schedule,votingEnd:at(9)},schedule.votingEnd),expectedScheduleVersion:4,...extra})};
}
test('saving extended times updates the same election without touching votes, candidates or turnout',async()=>{
 const h=browser();await h.run();const election=h.records.get('elections/usc-test');
 assert.equal(election.votingEnd.toMillis(),Date.parse(at(9)));assert.equal(election.scheduleVersion,5);assert.equal(election.candidateReviewComplete,true);
 assert.equal(h.records.get('elections/usc-test/turnout/public').ballotsCast,7);assert.equal(h.records.get('elections/usc-test/candidates/candidate').fullName,'Original');assert.equal(h.records.get('elections/usc-test/ballots/one').selections.President,'candidate');
 const audit=h.records.get('audit_logs/log-1');assert.equal(audit.actorUid,'officer');assert.equal(audit.details.beforeSchedule.votingEnd.toMillis(),Date.parse(at(5)));assert.equal(audit.details.afterSchedule.votingEnd.toMillis(),Date.parse(at(9)));
});
for(const flag of ['finalized','resultsPublished','archived'])test(`${flag} elections cannot be rescheduled`,async()=>{const h=browser({flags:{[flag]:true}});await assert.rejects(h.run(),/cannot be rescheduled/);assert.equal(h.records.size,5);});
test('an outdated editor version cannot overwrite another saved update',async()=>{const h=browser();await assert.rejects(h.run({expectedScheduleVersion:3}),/changed while you were editing/);assert.equal(h.records.get('elections/usc-test').scheduleVersion,4);});
test('concurrent finalization is rechecked on transaction retry',async()=>{const h=browser({retryFinalization:true});await assert.rejects(h.run(),/cannot be rescheduled/);assert.equal(h.records.get('elections/usc-test').finalized,true);assert.equal(h.records.get('elections/usc-test').votingEnd.toMillis(),Date.parse(at(5)));});
test('permission or audit failure leaves the original schedule unchanged',async()=>{for(const options of [{denied:true},{auditFails:true}]){const h=browser(options);await assert.rejects(h.run());assert.equal(h.records.get('elections/usc-test').scheduleVersion,4);}});

const cloud=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
function cloudSave(flags={}){
 const records=new Map([['elections/usc-test',{electionId:'usc-test',candidateReviewComplete:true,scheduleVersion:4,finalized:false,archived:false,resultsPublished:false,...flags}],['election_config/current',{electionId:'usc-test'}],['elections/usc-test/ballots/one',{votes:7}]]);
 const ctx=vm.createContext({exports:{},onCall:(_options,handler)=>handler,callableOptions:()=>({}),
  requireOfficerPermission:async(_request,permission)=>assert.equal(permission,'elections.view'),requireRecentAuth:()=>{},
  validateSchedule:raw=>raw,cleanText:(value,limit)=>String(value||'').trim().slice(0,limit),FieldValue:{serverTimestamp:()=>123},
  electionLifecycle:()=> 'Voting',auditData:(_request,action,target,before,after)=>({action,target,before,after}),
  HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},
  db:{doc:path=>({path}),collection:path=>({doc:()=>({path:path+'/audit'})}),runTransaction:async fn=>{
   const writes=[];const result=await fn({get:async ref=>({exists:records.has(ref.path),data:()=>records.get(ref.path),get:key=>records.get(ref.path)?.[key]}),set:(ref,value,options)=>writes.push([ref.path,options?.merge?{...records.get(ref.path),...value}:value])});
   for(const [path,value]of writes)records.set(path,value);return result;
  }}
 });
 vm.runInContext(cloud.slice(cloud.indexOf('exports.saveElectionSchedule ='),cloud.indexOf('exports.deleteElectionSchedule =')),ctx);
 return {records,run:()=>ctx.exports.saveElectionSchedule({auth:{uid:'officer'},data:{electionId:'usc-test',title:'Election',schedule,expectedScheduleVersion:4}})};
}
test('optional cloud save preserves review status and existing ballot records',async()=>{
 const h=cloudSave();await h.run();assert.equal(h.records.get('elections/usc-test').candidateReviewComplete,true);assert.equal(h.records.get('elections/usc-test').scheduleVersion,5);assert.equal(h.records.get('elections/usc-test/ballots/one').votes,7);
});
test('optional cloud save also refuses published-result and stale-version updates',async()=>{
 for(const flags of [{resultsPublished:true},{scheduleVersion:5}]){const h=cloudSave(flags);await assert.rejects(h.run());assert.equal(h.records.size,3);}
});

function scheduleEditor({saveFails=false}={}){
 const source=fs.readFileSync(new URL('../usc-admin/elections/js/elections.js',import.meta.url),'utf8'),messages=[];
 const ctx=vm.createContext({els:{saveElectionSettingsBtn:{},electionTitleInput:{value:'Election'}},setButtonState(){},msg:(...args)=>messages.push(args),clean:x=>String(x||''),$:()=>({value:'usc-test'}),scheduleEditorMode:'create',scheduleEditorOriginal:null,scheduleEditorVersion:null,schedulePayload:()=>schedule,callSecure:async()=>{if(saveFails)throw Error('Missing or insufficient permissions.');return{electionId:'usc-test',lifecycle:'Scheduled'}},refreshAll:async()=>{throw Error('Missing or insufficient permissions.')},console:{warn(){}},setTimeout(){throw Error('Must keep saved message visible')},closeScheduleEditor(){}});
 vm.runInContext(source.slice(source.indexOf('async function saveSchedule'),source.indexOf('async function deleteCurrentSchedule')),ctx);return{ctx,messages};
}
test('successful schedule save is not reported as denied when dashboard refresh fails',async()=>{const f=scheduleEditor();await f.ctx.saveSchedule();assert.match(f.messages.at(-1)[0],/was saved/);assert.equal(f.messages.at(-1)[1],'success');assert.equal(f.ctx.scheduleFormDirty,false)});
test('a denied schedule save remains an error rather than claiming success',async()=>{const f=scheduleEditor({saveFails:true});await f.ctx.saveSchedule();assert.equal(f.messages.at(-1)[0],'Missing or insufficient permissions.');assert.equal(f.messages.at(-1)[1],'error')});
