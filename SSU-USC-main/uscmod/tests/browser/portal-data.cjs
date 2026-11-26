// Real pages and hosted handlers; all records are synthetic and external requests blocked.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {historyFixture}=require('../helpers/officer-history-fixture.cjs');
const {createManagementHTTPHandler}=require('../../server/http.cjs');
const root=path.resolve(__dirname,'../..'),out='/tmp/portal-data-review';fs.mkdirSync(out,{recursive:true});
let api,failDirectory=false,failSurveys=false,failDraft=false;
const server=http.createServer((req,res)=>{
 if(req.url==='/api/management')return api(req,res);
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 const f=historyFixture();await f.assign('first','Public Information Officer');
 const survey=await f.h.needsAssessmentManage(f.req('first',{action:'save',input:{title:'Synthetic campus priorities',opensAt:f.now,closesAt:f.now+86400000,departments:['College of Engineering'],questions:[{label:'Priority?',type:'single',options:['A','B']}] }},'student'));
 const quotaError=()=>Object.assign(new Error('PRIVATE DATABASE DETAIL'),{code:8});
 const handlers={...f.handlers,...f.h,needsAssessmentList:async request=>{if(failSurveys)throw quotaError();return f.h.needsAssessmentList(request);},needsAssessmentManage:async request=>{if(failDraft)throw quotaError();return f.h.needsAssessmentManage(request);},studentRecordsList:async request=>{if(failDirectory)throw new (require('../../server/settings.cjs').ServiceError)('unavailable','Synthetic directory outage');return f.handlers.studentRecordsList({...f.admin,data:request.data});}};
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 api=createManagementHTTPHandler({hosted:false,log(){},getRuntime:()=>({settings:{allowedOrigins:new Set([base])},handlers,verifyIdToken:async uid=>({uid,role:uid==='admin'?'admin':'student',email_verified:true,auth_time:f.now/1000})})});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
  await context.addInitScript(now=>{Date.now=()=>now;globalThis.USC_AUTH_READY=Promise.resolve(true);sessionStorage.setItem('studentProfile',JSON.stringify({uid:'first',role:'officer',officePosition:'Public Information Officer',officerPermissionSource:'position-default'}));},f.now);
  const firestore=`
export const collection=(_db,name)=>({name}),collectionGroup=(_db,name)=>({name});
export const doc=(...x)=>x,query=(base,...clauses)=>({...base,clauses}),orderBy=(...args)=>({type:'orderBy',args}),where=(...args)=>({type:'where',args}),limit=n=>({type:'limit',n}),documentId=()=> '__name__',startAfter=cursor=>({type:'cursor',cursor});
export const getCountFromServer=async()=>{throw Object.assign(Error('Synthetic aggregate failure'),{code:location.search.includes('quota')?'resource-exhausted':'failed-precondition'})};
export const getDocs=async q=>{globalThis.syntheticPageReads=(globalThis.syntheticPageReads||0)+1;const rows=Array.from({length:205},(_,i)=>({id:String(i),data:()=>({status:i<200?'Submitted':'Resolved',classification:'Student Level'})}));return {docs:q.clauses.some(c=>c.type==='cursor')?rows.slice(200):rows.slice(0,200)}};
export const onSnapshot=(q,next)=>{next({docs:[]});return ()=>{}};
export const runTransaction=async()=>{},serverTimestamp=()=>0,Timestamp={fromMillis:x=>x};`;
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:firestore});
   if(u.origin!==base)return route.abort();
   if(/auth-guard\.js|admin-auth\.js|admin-only-auth\.js|profile-manager\.js/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   if(u.pathname==='/firebase/firebase-config.js')return route.fulfill({contentType:'text/javascript',body:`export const auth={currentUser:{uid:'first',getIdToken:async()=>location.pathname.includes('student-records')?'admin':'first'}};export const db={};export const appCheck=null,functions={};`});
   if(u.pathname==='/shared/security-client.js')return route.fulfill({contentType:'text/javascript',body:'export const hydrateMediaImages=async()=>{},resolveMediaUrl=async x=>x;'});
   if(u.pathname==='/shared/officer-activity-client.js')return route.fulfill({contentType:'text/javascript',body:'export const trackedOfficerAction=async()=>null,activityAttributionText=()=>"",activityHistoryHref=()=>"#";'});
   if(u.pathname.endsWith('/facebook-publishing.js'))return route.fulfill({contentType:'text/javascript',body:'export const initializeFacebookPublishing=()=>{},hydrateFacebookDeliveries=async()=>{},facebookRequest=async()=>({});'});
   return route.continue();
  });
  const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));
  failSurveys=true;
  await p.goto(base+'/usc-admin/needs-assessment/needs-assessment.html');
  await p.getByText('Unable to load surveys. Select Refresh to try again.',{exact:true}).waitFor();
  assert.match(await p.locator('#naMessage').innerText(),/database has reached a usage limit.*Reference: [a-f0-9-]{36}/);
  assert.equal(await p.locator('#naSurveys').getAttribute('aria-busy'),null);
  assert.doesNotMatch(await p.locator('#naSurveys').innerText(),/Loading surveys|No surveys yet/);
  failSurveys=false;await p.locator('#naRefresh').click();await p.getByText('Synthetic campus priorities',{exact:true}).waitFor();
  failSurveys=true;await p.locator('#naRefresh').click();await p.waitForFunction(()=>document.querySelector('#naMessage').dataset.error==='true');
  assert.equal(await p.getByText('Synthetic campus priorities',{exact:true}).isVisible(),true);
  failSurveys=false;await p.locator('#naRefresh').click();await p.waitForFunction(()=>document.querySelector('#naMessage').textContent==='');
  await p.getByRole('button',{name:'View Results',exact:true}).click();await p.locator('#naResultsContent').waitFor({state:'visible'});assert.equal(await p.locator('.na-stat strong').first().innerText(),'0');await p.keyboard.press('Escape');
  await p.screenshot({path:out+'/surveys.png'});
  await p.goto(base+'/usc-admin/needs-assessment/create-survey.html');
  await p.getByRole('textbox',{name:'Survey title',exact:true}).fill('Quota recovery draft');
  await p.getByRole('textbox',{name:'Question title',exact:true}).fill('Which service should we prioritize?');
  await p.getByRole('textbox',{name:'Option 1',exact:true}).fill('Study spaces');
  await p.getByRole('textbox',{name:'Option 2',exact:true}).fill('Peer support');
  failDraft=true;await p.locator('#save').click();
  await p.getByText(/Could not confirm the draft was saved.*database has reached a usage limit/).waitFor();
  assert.equal(await p.getByRole('textbox',{name:'Survey title',exact:true}).innerText(),'Quota recovery draft');
  assert.equal(await p.getByRole('textbox',{name:'Option 2',exact:true}).inputValue(),'Peer support');
  failDraft=false;await p.locator('#save').click();await p.getByText('Draft saved. Return to Needs Assessment to publish.').waitFor();
  await p.goto(base+'/usc-admin/needs-assessment/needs-assessment.html');
  await p.getByText('Quota recovery draft',{exact:true}).waitFor();
  await p.goto(base+'/usc-admin/officer-tracklist/officer-tracklist.html');await p.locator('.activity-list li').first().waitFor();assert.match(await p.locator('.activity-list').innerText(),/Survey created/);await p.screenshot({path:out+'/recent-activity.png'});
  await p.goto(base+'/usc-admin/admin-dashboard/student-records.html');await p.locator('#openStudentDirectory').click();await p.locator('[data-student="990001"]').waitFor();
  await p.locator('#closeStudentDirectory').click();failDirectory=true;await p.locator('#openStudentDirectory').click();await p.getByText('Student records could not be loaded. Select Refresh to try again.').waitFor();failDirectory=false;await p.locator('#refreshStudents').click();await p.locator('[data-student="990001"]').waitFor();await p.screenshot({path:out+'/student-directory.png'});
  await p.goto(base+'/usc-admin/overview/overview.html');await p.waitForFunction(()=>document.querySelector('[data-summary="complaint"] .overview-chart-legend')?.textContent.includes('200'));assert.match(await p.locator('[data-summary="complaint"]').innerText(),/Resolved/);assert.doesNotMatch(await p.locator('[data-summary="complaint"]').innerText(),/Data unavailable/);await p.screenshot({path:out+'/complaint-analytics.png'});
  assert.equal(await p.evaluate(()=>globalThis.syntheticPageReads),2);
  await p.goto(base+'/usc-admin/overview/overview.html?quota');
  await p.locator('[data-summary="complaint"]').getByText('Data unavailable').waitFor();
  assert.equal(await p.evaluate(()=>globalThis.syntheticPageReads||0),0);
  await p.goto(base+'/usc-admin/announcements/announcements.html');await p.locator('#announcementTitle').fill('Synthetic announcement preview');await p.locator('#announcementContent').fill('First paragraph.\n\nSecond paragraph.');
  assert.equal(await p.locator('#previewTitle').innerText(),'Synthetic announcement preview');assert.match(await p.locator('#previewContent').innerText(),/First paragraph\.\n\nSecond/);
  assert.ok((await p.locator('#announcementPreviewImageWrap').boundingBox()).height<100);
  const image=await p.locator('#announcementPreviewCard').screenshot();
  await p.locator('#announcementImage').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
  await p.waitForFunction(()=>document.querySelector('#announcementPreviewImage')?.complete && document.querySelector('#announcementPreviewImage').naturalWidth>0);
  assert.equal(await p.locator('#announcementPreviewPlaceholder').isVisible(),false);
  for(const width of [1440,390]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:out+'/announcement-'+width+'.png'});}
  assert.deepEqual(errors,[]);console.log('PASS: survey error/retry/support references and preserving loaded surveys; surveys with student claims, survey results, recent survey activity, directory open/error/retry, 205 complaint records across fallback pages, desktop/mobile live preview.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
