import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEngagement,buildEngagementReport,reportDocument,registrationSummary} from '../shared/engagement-report-model.mjs';
const at=(hour,minute=0)=>new Date(2026,9,19,hour,minute).getTime();
const base={id:'one',title:'Leadership workshop',eventDate:'2026-10-19',startTime:'09:00',endTime:'11:00',status:'Published',registrationMode:'internal',venue:'Hall',hostOrganization:'Partner',publishedAtMs:at(7)};

test('statuses use local schedule boundaries, with explicit cancellation/completion respected',()=>{
 assert.equal(classifyEngagement(base,at(8,59)),'Upcoming');
 assert.equal(classifyEngagement(base,at(9)),'Active');
 assert.equal(classifyEngagement(base,at(10,59)),'Active');
 assert.equal(classifyEngagement(base,at(11)),'Completed');
 for(const status of ['Cancelled','canceled','CANCELLED'])assert.equal(classifyEngagement({...base,status},at(10)),'Cancelled');
 assert.equal(classifyEngagement({...base,status:'Completed'},at(8)),'Completed');
});
test('date-only records are active for their full local day and invalid dates are unscheduled',()=>{
 const allDay={...base,startTime:'',endTime:''};
 assert.equal(classifyEngagement(allDay,at(0)),'Active');
 assert.equal(classifyEngagement(allDay,new Date(2026,9,19,23,59,59,999).getTime()),'Active');
 assert.equal(classifyEngagement(allDay,new Date(2026,9,20).getTime()),'Completed');
 for(const change of [{eventDate:''},{eventDate:'2026-02-30'},{startTime:'25:00'},{endTime:'08:00'}])assert.equal(classifyEngagement({...base,...change},at(10)),'Unscheduled');
});
test('breakdown totals reconcile with records, and schedule progress is separate from participation',()=>{
 const records=[base,{...base,id:'two',eventDate:'2027-01-01'},{...base,id:'three',eventDate:'2020-01-01'},{...base,id:'four',status:'Cancelled'},{...base,id:'five',eventDate:''}];
 const report=buildEngagementReport(records,new Map(),{now:at(10)});
 assert.deepEqual(report.breakdown,{Active:1,Upcoming:1,Completed:1,Cancelled:1,Unscheduled:1});
 assert.equal(Object.values(report.breakdown).reduce((a,b)=>a+b,0),report.total);
 assert.equal(report.items[0].scheduleElapsedPercent,50);
 assert.equal(report.items[0].participantCount,null);
 assert.equal(report.knownPortalRegistrations,0);
 assert.equal(report.pendingOrUnavailable,5);
});
test('ready, loading, denied, external and no-registration states never fabricate participant counts',()=>{
 const records=[base,...['loading','denied','external','none','empty'].map(id=>({...base,id,registrationMode:id==='external'?'external':id==='none'?'none':'internal'}))];
 const registrations=new Map([['one',{state:'ready',records:[{fullName:'Ana',studentId:'2026-01',program:'BSCS',college:'Science',registeredAt:{toMillis:()=>at(8)}}]}],['denied',{state:'unavailable'}],['empty',{state:'ready',records:[]}]]);
 const report=buildEngagementReport(records,registrations,{now:at(10)});
 assert.deepEqual(report.items.map(i=>i.participantCount),[1,null,null,null,null,0]);
 assert.equal(report.knownPortalRegistrations,1);
 assert.equal(report.pendingOrUnavailable,2);
 assert.equal(report.items[0].participants[0].registeredAt,at(8));
 assert.match(registrationSummary(report.items[2]),/unavailable/);
 assert.match(registrationSummary(report.items[3]),/not tracked/);
});
test('individual and status-filtered reports contain only their actual scoped records and rosters',()=>{
 const records=[base,{...base,id:'past',eventDate:'2020-01-01'}];
 const entries=new Map([['one',{state:'ready',records:[{fullName:'Ana'}]}],['past',{state:'ready',records:[{fullName:'Ben'},{fullName:'Sam'}]}]]);
 const before=JSON.stringify(records);
 const individual=buildEngagementReport(records,entries,{recordId:'past',kind:'programs',now:at(10)});
 assert.equal(individual.total,1);assert.equal(individual.knownPortalRegistrations,2);assert.equal(individual.items[0].hostOrganization,'Partner');
 const active=buildEngagementReport(records,entries,{status:'Active',now:at(10)});
 assert.equal(active.total,1);assert.equal(active.items[0].participants[0].fullName,'Ana');
 assert.equal(JSON.stringify(records),before);
 assert.equal(buildEngagementReport([],new Map(),{now:at(10)}).total,0);
});
test('generated HTML preserves real records, completion caveats and timestamp while escaping content',()=>{
 const record={...base,title:'<script>alert(1)</script>',description:'<img src=x onerror=alert(1)>',eventDate:'2020-01-01',registrationMode:'external'};
 const report=buildEngagementReport([record],new Map(),{now:at(10)});
 const html=reportDocument(report);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x/);
 assert.match(html,/External registrations/);assert.match(html,/not independently verified/);assert.match(html,/Leadership|Venue|Hall/);
 assert.match(report.generatedAt,/2026-10-19/);
 assert.equal(report.items[0].updatedAt,null);
});
