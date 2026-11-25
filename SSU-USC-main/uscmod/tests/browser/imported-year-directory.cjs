// Real pages/controllers with synthetic Auth/Firestore and actual management HTTP handlers.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {historyFixture}=require('../helpers/officer-history-fixture.cjs');
const {createManagementHTTPHandler}=require('../../server/http.cjs');
const root=path.resolve(__dirname,'../..'),out=process.env.USC_REVIEW_OUTPUT||'/tmp/import-year-review';
fs.mkdirSync(out,{recursive:true});
const f=historyFixture();let origin;
const {createStudentRecordHandlers}=require('../../functions/student-records.js');
const {ServiceError}=require('../../server/settings.cjs');
const academic=createStudentRecordHandlers({db:f.db,adminAuth:f.adminAuth,...f.authorization,HttpsError:ServiceError,clock:()=>f.now,sendActivation:async()=>{throw Error('No email expected');}});
const api=createManagementHTTPHandler({hosted:false,log(){},getRuntime:()=>({settings:{allowedOrigins:new Set([origin])},handlers:{...f.h,...academic},verifyIdToken:async()=>({uid:'admin',role:'admin',email_verified:true,auth_time:f.now/1000})})});
const server=http.createServer((req,res)=>{const u=new URL(req.url,origin);if(u.pathname==='/api/management')return api(req,res);const file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const college=require('../../functions/student-records-model.js').DEPARTMENTS[3];
  Object.assign(f.records.get('users/first'),{yearLevel:'1st Year',academicYear:'2025-2026',college,program:'Bachelor of Science in Civil Engineering'});
  Object.assign(f.records.get('users/second'),{yearLevel:'4th Year'});
  f.authUsers.get('first').password='Unchanged-existing-password';
  await f.assign('first','President');
  f.records.set('student_records/first',{...f.records.get('users/first'),yearLevel:'2nd Year',academicYear:'2026-2027',accountUid:'first',recordRevision:'prior-import'});
  f.records.set('student_record_ids/990001',{uid:'first'});
  const authBefore=structuredClone(f.authUsers.get('first'));
  const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
  await context.addInitScript(()=>{globalThis.USC_AUTH_READY=Promise.resolve(true);sessionStorage.setItem('studentProfile',JSON.stringify({uid:'admin',role:'admin',fullName:'Synthetic Administrator'}));globalThis.directoryWrites=[];});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-firestore.js')){
    const users=[...f.records].filter(([p])=>p.startsWith('users/')&&p.split('/').length===2).map(([p,data])=>({id:p.split('/')[1],data}));
    return route.fulfill({contentType:'text/javascript',body:`let users=${JSON.stringify(users)};const listeners=[];globalThis.fixtureUpdateUsers=rows=>{users=rows;for(const cb of listeners)cb({docs:users.map(r=>({id:r.id,data:()=>r.data}))});};export const collection=(_, ...p)=>p.join('/');export const doc=(_, ...p)=>p.join('/');export const onSnapshot=(ref,cb)=>{if(ref==='users')listeners.push(cb);cb({docs:ref==='users'?users.map(r=>({id:r.id,data:()=>r.data})):[]});return()=>{};};export const getDocs=async()=>({docs:[]});export const getDoc=async()=>({exists:()=>false});export const addDoc=async()=>{};export const updateDoc=async()=>{};export const writeBatch=()=>({update(){},set(){},commit:async()=>{}});export const serverTimestamp=()=>0;export const Timestamp={fromMillis:n=>n};export const query=(r)=>r;export const limit=()=>0;export const orderBy=()=>0;`});
   }
   if(u.origin!==origin)return route.abort();
   if(/auth-guard\.js|admin-only-auth\.js|profile-manager\.js/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   if(u.pathname==='/firebase/firebase-config.js')return route.fulfill({contentType:'text/javascript',body:'export const auth={currentUser:{uid:"admin",getIdToken:async()=>"fixture-admin"}};export const db={};export const appCheck=null;export const functions={};'});
   if(u.pathname==='/shared/security-client.js')return route.fulfill({contentType:'text/javascript',body:'export {auth} from "/firebase/firebase-config.js";export const callSecure=async(name,data)=>{if(name==="getElectionContext")return{electionId:"synthetic"};directoryWrites.push({name,data});return{updated:true};};'});
   return route.continue();
  });
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.goto(origin+'/usc-admin/admin-dashboard/users.html');await p.locator('[data-account-name="first"]').click();
  const year=p.locator('#yearLevelSelect');
  await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='2nd Year');
  assert.equal(await year.getAttribute('readonly'),'');assert.equal(await year.evaluate(e=>e.tagName),'INPUT');
  assert.equal(f.records.get('users/first').yearLevel,'1st Year');
  await p.locator('#accountStudentTitle').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'imported-year-before.png')});
  // Even an altered DOM field cannot make a directory save write academic year/level.
  await year.evaluate(e=>e.value='5th Year');await p.locator('#adminNotesInput').fill('Synthetic status review');await p.locator('#saveRoleButton').click();
  await p.waitForFunction(()=>directoryWrites.some(w=>w.name==='adminUpdateUser'));
  const write=await p.evaluate(()=>directoryWrites.find(w=>w.name==='adminUpdateUser').data);
  assert.equal(Object.hasOwn(write,'yearLevel'),false);assert.equal(Object.hasOwn(write,'academicYear'),false);
  await p.keyboard.press('Escape');await p.locator('[data-account-name="first"]').click();await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='2nd Year');
  const importResult=await p.evaluate(async input=>{const {hostedManagementCall:call}=await import('/shared/hosted-management-client.js');const preview=await call('studentAnnualPreview',{rows:[input],academicYear:'2026-2027',authorized:true});return preview;},{studentId:'990001',fullName:'Synthetic first',department:college,program:'Bachelor of Science in Civil Engineering',yearLevel:'3',email:'first@example.invalid',status:'active'});
  assert.equal(f.records.get('users/first').yearLevel,'1st Year');assert.equal(await year.inputValue(),'2nd Year');
  await p.locator('#adminNotesInput').fill('Unsaved note kept during academic refresh');
  const applied=await p.evaluate(async importId=>{const {hostedManagementCall:call}=await import('/shared/hosted-management-client.js');return call('studentAnnualApply',{importId,start:0,confirmed:true});},importResult.importId);
  assert.equal(applied.results[0].state,'complete');
  await p.evaluate(rows=>fixtureUpdateUsers(rows),[...f.records].filter(([path])=>path.startsWith('users/')&&path.split('/').length===2).map(([path,data])=>({id:path.split('/')[1],data})));
  await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='3rd Year');
  assert.equal(await p.locator('#adminNotesInput').inputValue(),'Unsaved note kept during academic refresh');
  assert.equal(f.records.get('users/first').role,'officer');assert.equal(f.records.get('users/first').officePosition,'President');assert.deepEqual(f.authUsers.get('first'),authBefore);
  await p.locator('#accountStudentTitle').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'imported-year-after.png')});
  await p.setViewportSize({width:390,height:1000});await p.locator('#accountStudentTitle').scrollIntoViewIfNeeded();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:path.join(out,'imported-year-mobile.png')});
  await p.keyboard.press('Escape');await p.locator('[data-account-name="second"]').click();await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='Not recorded');
  assert.match(await p.locator('#importedYearNote').innerText(),/No linked imported Student Record/);
  await p.keyboard.press('Escape');
  let failLookup=false,delayLookup=true,releaseReply,notifyHeld;
  const heldReply=new Promise(resolve=>notifyHeld=resolve);
  await p.route('**/api/management',async route=>{
    const payload=route.request().postDataJSON();
    if(payload.action!=='studentRegistrationLookup')return route.continue();
    if(failLookup)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'Synthetic outage'}})});
    if(delayLookup&&payload.data.studentId==='990001'){
      const response=await route.fetch();await new Promise(resolve=>{releaseReply=resolve;notifyHeld();});return route.fulfill({response});
    }
    return route.continue();
  });
  await p.locator('[data-account-name="first"]').click();await heldReply;assert.equal(await year.inputValue(),'Loading…');
  await p.keyboard.press('Escape');await p.locator('[data-account-name="second"]').click();await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='Not recorded');
  const released=p.waitForResponse(response=>response.url().endsWith('/api/management')&&response.request().postDataJSON().data.studentId==='990001');
  delayLookup=false;releaseReply();await released;await p.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await p.locator('#selectedUserName').innerText(),'Synthetic second');assert.equal(await year.inputValue(),'Not recorded');
  await p.keyboard.press('Escape');failLookup=true;
  await p.locator('[data-account-name="first"]').click();await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='Unavailable');assert.equal(await year.evaluate(e=>e.readOnly),true);
  failLookup=false;await p.keyboard.press('Escape');await p.locator('[data-account-name="first"]').click();await p.waitForFunction(()=>document.querySelector('#yearLevelSelect').value==='3rd Year');
  assert.deepEqual(errors,[]);
  console.log('PASS: canonical year displays despite stale legacy profile; read-only field; directory saves omit year; preview makes no change; apply syncs the same officer UID; live snapshot refreshes open modal; credentials/President role preserved; legacy no-record state; delayed response isolation; lookup error and retry; desktop/mobile. Synthetic data only.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
