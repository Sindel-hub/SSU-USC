import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { summarize, csv, summaryRows } from '../shared/needs-assessment-report.mjs';
import { surveyIdFromLink, surveyAnnouncementLink } from '../shared/survey-links.mjs';
import { SSU_PROGRAMS } from '../usc-admin/student-registration/js/ssu-programs.js';
const require=createRequire(import.meta.url);
const { DEPARTMENTS, validateSurvey, validateResponse, surveyStatus }=require('../functions/needs-assessment-model.js');
const { createNeedsAssessmentHandlers }=require('../functions/needs-assessment.js');
const input=()=>({title:'Student priorities',description:'Tell us your needs.',departments:DEPARTMENTS,opensAt:100,closesAt:200,questions:[{label:'Priority',type:'single',options:['Wellness','Facilities']},{label:'Interests',type:'multiple',options:['Sports','Arts']},{label:'Satisfaction',type:'rating'},{label:'Suggestions',type:'text',required:false}]});
const answer=()=>({department:DEPARTMENTS[0],answers:{q1:'Wellness',q2:['Arts'],q3:4,q4:'More quiet spaces'}});
test('survey validation bounds content, questions, schedules and departments',()=>{
 const s=validateSurvey(input());assert.equal(s.questions[0].id,'q1');assert.deepEqual(DEPARTMENTS,Object.keys(SSU_PROGRAMS));
 for(const change of [{title:''},{closesAt:90},{departments:['Fake']},{departments:'all'},{questions:[]},{questions:[{label:'Bad',type:'single',options:['A','A']}]},{questions:Array(31).fill(input().questions[0])}])assert.throws(()=>validateSurvey({...input(),...change}));
});
test('schedule boundaries and unpublished surveys reject anonymous submissions',()=>{
 const s={...validateSurvey(input()),status:'published'};
 assert.equal(surveyStatus(s,99),'scheduled');assert.equal(surveyStatus(s,100),'open');assert.equal(surveyStatus(s,200),'closed');
 for(const now of [99,200])assert.throws(()=>validateResponse(s,answer(),now));
 for(const status of ['draft','closed','archived'])assert.throws(()=>validateResponse({...s,status},answer(),150));
});
test('answers reject foreign departments, missing required values, invented options and extra questions',()=>{
 const s={...validateSurvey(input()),status:'published'};
 assert.equal(validateResponse(s,answer(),150).answers.q3,4);
 for(const a of [{...answer(),department:'Fake'},{...answer(),answers:{q1:'Wellness'}},{...answer(),answers:{...answer().answers,q2:['Arts','Arts']}},{...answer(),answers:{...answer().answers,q1:'Other'}},{...answer(),answers:{...answer().answers,q3:6}},{...answer(),answers:{...answer().answers,q5:'unexpected'}}])assert.throws(()=>validateResponse(s,a,150));
});
test('department reports count multiselect independently, handle empty results and optional text',()=>{
 const s=validateSurvey(input()),rows=[answer(),{department:DEPARTMENTS[1],answers:{q1:'Facilities',q2:['Sports','Arts'],q3:2}}];
 const all=summarize(s,rows);assert.equal(all.total,2);assert.equal(all.questions[2].average,3);assert.equal(all.questions[1].counts[1].count,2);assert.equal(summarize(s,rows,DEPARTMENTS[0]).total,1);assert.equal(summarize(s,[]).questions[2].average,null);assert.ok(summaryRows(all).length>5);
});
test('CSV escapes quotes, line breaks and spreadsheet formulas',()=>{
 const output=csv([['=cmd()', '"quoted"', 'two\nlines', '\t=bad']]);assert.ok(output.includes('"\'=cmd()"'));assert.ok(output.includes('""quoted""'));assert.ok(output.includes('two\nlines'));assert.ok(output.includes("'\t=bad"));
});
test('announcement links accept only internal survey paths and safe IDs',()=>{
 const id='A'.repeat(20),origin='https://portal.test';assert.equal(surveyIdFromLink(`${origin}/survey/index.html?id=${id}`,origin),id);assert.equal(surveyIdFromLink(`https://public.test/survey/index.html?id=${id}`,origin,'https://public.test'),id);assert.equal(surveyAnnouncementLink({surveyId:id}),`/survey/index.html?id=${id}`);
 for(const value of ['javascript:alert(1)',`https://evil.test/survey/index.html?id=${id}`,`${origin}/home/home.html?id=${id}`,`${origin}/survey/index.html?id=../bad`])assert.throws(()=>surveyIdFromLink(value,origin));assert.equal(surveyAnnouncementLink({surveyId:'" onclick="x'}),'');
});
// Serial transaction double emulates atomic commits without any remote student data.
function harness() {
 const records=new Map();let serial=Promise.resolve(),seq=0;
 const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),collection:name=>coll(`${path}/${name}`)});
 const snap=path=>({exists:records.has(path),id:path.split('/').at(-1),data:()=>records.get(path)});
 const coll=path=>({doc:(id=String(++seq).padStart(20,'A'))=>ref(`${path}/${id}`)});
 const db={collection:coll,runTransaction:fn=>{const result=serial.then(async()=>{const writes=[];const tx={get:async r=>snap(r.path),set:(r,d)=>writes.push(()=>records.set(r.path,d)),create:(r,d)=>writes.push(()=>{assert.ok(!records.has(r.path));records.set(r.path,d);}),update:(r,d)=>writes.push(()=>records.set(r.path,{...records.get(r.path),...d}))};const r=await fn(tx);writes.forEach(w=>w());return r;});serial=result.catch(()=>{});return result;}};
 class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
 let now=150;
 const role=async (request,roles=['officer','admin'])=>{if(!request.auth?.active||!roles.includes(request.auth.role))throw new HttpsError('permission-denied','No access');return request.auth.profile;};
 const h=createNeedsAssessmentHandlers({db,clock:()=>now,HttpsError,requireActiveRole:role,requireOfficerPermission:async request=>{await role(request);if(!request.auth.manage)throw new HttpsError('permission-denied','Read only');}});
 const officer={auth:{uid:'officer',role:'officer',active:true,manage:true}};
 return {records,h,officer,setNow:v=>now=v};
}
test('server rejects unauthorized management and response reads',async()=>{
 const {h}=harness();for(const name of ['needsAssessmentManage','needsAssessmentResponses','needsAssessmentList'])await assert.rejects(h[name]({data:{}}),{code:'permission-denied'});
 await assert.rejects(h.needsAssessmentManage({auth:{role:'officer',active:true},data:{action:'save',input:input()}}),{code:'permission-denied'});
});
const student=(n=1,uid='student-'+n)=>({auth:{uid,role:'student',active:true,profile:{studentId:String(n).padStart(9,'0'),college:DEPARTMENTS[0]}}});
test('authenticated participation is atomic, private and stable across replacement accounts',async()=>{
 const {h,officer,records}=harness();
 const {id}=await h.needsAssessmentManage({...officer,data:{action:'save',input:input()}});
 const data={surveyId:id,...answer()};
 await assert.rejects(h.needsAssessmentPublic({...student(),data}),{code:'not-found'});
 await h.needsAssessmentManage({...officer,data:{action:'publish',surveyId:id}});
 await assert.rejects(h.needsAssessmentPublic({data}),{code:'permission-denied'});
 await assert.rejects(h.needsAssessmentSubmit({data}),{code:'permission-denied'});
 await assert.rejects(h.needsAssessmentSubmit({...officer,data}),{code:'permission-denied'});
 const pub=await h.needsAssessmentPublic({...student(),data});assert.equal(pub.alreadySubmitted,false);assert.equal(pub.createdBy,undefined);assert.equal(pub.responseCount,undefined);
 const invalid={...data,answers:{}};await assert.rejects(h.needsAssessmentSubmit({...student(),data:invalid}),{code:'invalid-argument'});
 assert.equal((await h.needsAssessmentPublic({...student(),data})).alreadySubmitted,false);
 const results=await Promise.all(Array.from({length:5},(_,i)=>h.needsAssessmentSubmit({...student(1,'replacement-'+i),data:{...data,studentId:'forged',department:DEPARTMENTS[1]}})));
 assert.equal(results.filter(x=>x.submitted).length,1);assert.equal(results.filter(x=>x.alreadySubmitted).length,4);
 assert.equal((await h.needsAssessmentPublic({...student(1,'new-account'),data})).alreadySubmitted,true);
 assert.equal((await h.needsAssessmentSubmit({...student(2),data})).submitted,true);
 const rows=[...records].filter(([p])=>p.includes('/responses/'));const markers=[...records].filter(([p])=>p.includes('/participation_private/'));
 assert.equal(rows.length,2);assert.equal(markers.length,2);assert.equal(records.get('needs_assessment_surveys/'+id).responseCount,2);
 for(const [path,row] of rows){assert.deepEqual(Object.keys(row).sort(),['answers','department','submittedAt']);assert.equal(row.department,DEPARTMENTS[0]);assert.ok(!markers.some(([m])=>m.split('/').at(-1)===path.split('/').at(-1)));}
 await h.needsAssessmentManage({...officer,data:{action:'close',surveyId:id}});
 await assert.rejects(h.needsAssessmentSubmit({...student(3),data}),{code:'invalid-argument'});
 assert.equal((await h.needsAssessmentSubmit({...student(),data})).alreadySubmitted,true);
});
test('submission throttling rejects excess distinct students atomically',async()=>{
 const {h,officer,records}=harness();const {id}=await h.needsAssessmentManage({...officer,data:{action:'save',input:input()}});await h.needsAssessmentManage({...officer,data:{action:'publish',surveyId:id}});
 for(let n=1;n<=30;n++)await h.needsAssessmentSubmit({...student(n),data:{surveyId:id,...answer()}});
 await assert.rejects(h.needsAssessmentSubmit({...student(31),data:{surveyId:id,...answer()}}),{code:'resource-exhausted'});assert.equal(records.get('needs_assessment_surveys/'+id).responseCount,30);
});
