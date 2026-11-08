import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {complaintFixture} from './helpers/complaint-workflow-fixture.mjs';import {processComplaintNotification} from '../supabase/functions/_shared/complaint-workflow.mjs';
import {processCandidateNotification} from '../supabase/functions/_shared/candidate-registration.mjs';
const student={uid:'student'};
function schedule(h,id){h.seed(`elections/${id}`,{title:'Election '+id,registrationStart:h.clock-1000,registrationEnd:h.clock+1000,applicationReviewStart:h.clock+1000,applicationReviewEnd:h.clock+3000,votingStart:h.clock+4000,votingEnd:h.clock+5000});h.seed('election_config/current',{electionId:id})}
function application(electionId){return {electionId,requestId:randomUUID(),position:'President',partylist:'Independent',platform:'Student platform',campaignPhotoPath:'private/photo',supportingDocumentPaths:[]}}
test('retained completed/deleted-schedule history, new election registration and complaints coexist',async()=>{
 const h=complaintFixture();schedule(h,'A');await h.candidate.submit(student,application('A'));const before=structuredClone(h.records.get('elections/A/applications/student'));
 h.seed('elections/A',{...h.records.get('elections/A'),finalized:true,resultsPublished:true,scheduleDeleted:true});h.seed('elections/A/ballots/ballot',{selections:{President:'candidate-a'}});h.seed('elections/A/results/official',{votes:9});
 schedule(h,'B');await h.candidate.submit(student,application('B'));const complaint=await h.submit({type:'Feedback',attachment:true});
 h.clock+=1500;await h.candidate.review({uid:'reviewer'},{electionId:'B',applicantUid:'student',decision:'approve',publicMessage:'Approved.'});await h.update(complaint,{status:'In Progress',classification:'Crisis Level',feedback:'PRIVATE USC REVIEW'});
 assert.deepEqual(h.records.get('elections/A/applications/student'),before);assert.equal(h.records.get('elections/A/results/official').votes,9);assert.equal(h.records.get('elections/A/ballots/ballot').selections.President,'candidate-a');assert.equal(h.records.get('elections/B/applications/student').status,'Approved');assert.equal(h.records.get(`complaints/${complaint.complaintId}`).status,'In Progress');
 const publicCandidate=[...h.records].find(([path])=>path.startsWith('elections/B/candidates/'))[1];assert.equal(publicCandidate.email,undefined);
 for(const [path]of h.events())await processComplaintNotification(path.split('/')[1],h.deps);
 for(const [path]of [...h.records].filter(([path])=>path.startsWith('candidate_email_events/')))await processCandidateNotification(path.split('/')[1],h.deps);
 assert.equal(h.sent.length,5);for(const item of h.sent.filter(item=>item.message.subject.includes('Submission')))assert.doesNotMatch(item.message.text,/PRIVATE USC REVIEW|CONFIDENTIAL|Crisis Level|Private Student Name|Private Department/);
});
test('candidacy approval remains separate from the shared complaint email requirement',async()=>{const h=complaintFixture();h.seed('users/student',{...h.records.get('users/student'),candidacyApproved:false});schedule(h,'B');await assert.rejects(h.candidate.submit(student,application('B')),{code:'permission-denied'});await h.submit();assert.equal(h.events().length,1)});
test('synthetic backup integrity and recovery preserve settled delivery and election data',async()=>{
 const h=complaintFixture(),result=await h.submit({attachment:true}),eventId=h.events()[0][0].split('/')[1];await processComplaintNotification(eventId,h.deps);h.seed('elections/A/results/official',{votes:42});
 const snapshot=structuredClone({records:[...h.records],versions:[...h.versions]}),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),expected=digest(snapshot);
 h.records.set(`complaints/${result.complaintId}`,{corrupted:true});h.records.clear();h.versions.clear();snapshot.records.forEach(([p,data])=>h.records.set(p,data));snapshot.versions.forEach(([p,version])=>h.versions.set(p,version));
 assert.equal(digest({records:[...h.records],versions:[...h.versions]}),expected);assert.equal(h.records.get('elections/A/results/official').votes,42);await processComplaintNotification(eventId,h.deps);assert.equal(h.sent.length,1);assert.equal(h.records.get(`complaint_email_events/${eventId}`).state,'sent');
});
