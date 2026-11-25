// Real pages/controllers with synthetic Auth/Firestore and actual management HTTP handlers.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {historyFixture}=require('../helpers/officer-history-fixture.cjs');
const {createManagementHTTPHandler}=require('../../server/http.cjs');
const root=path.resolve(__dirname,'../..'),out=process.env.USC_REVIEW_OUTPUT||'/tmp/officer-management-only';
fs.mkdirSync(out,{recursive:true});
const f=historyFixture();let origin, forceStaleAuth=false;
const api=createManagementHTTPHandler({hosted:false,log(){},getRuntime:()=>({settings:{allowedOrigins:new Set([origin])},handlers:f.h,verifyIdToken:async()=>({uid:'admin',role:'admin',email_verified:true,auth_time:f.now/1000-(forceStaleAuth?1801:0)})})});
const server=http.createServer((req,res)=>{const u=new URL(req.url,origin);if(u.pathname==='/api/management')return api(req,res);const file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{globalThis.USC_AUTH_READY=Promise.resolve(true);sessionStorage.setItem('studentProfile',JSON.stringify({uid:'admin',role:'admin',fullName:'Synthetic Administrator'}));globalThis.directoryWrites=[];});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-firestore.js')){
    const users=[...f.records].filter(([p])=>p.startsWith('users/')).map(([p,data])=>({id:p.split('/')[1],data}));
    return route.fulfill({contentType:'text/javascript',body:`const users=${JSON.stringify(users)};export const collection=(_, ...p)=>p.join('/');export const doc=(_, ...p)=>p.join('/');export const onSnapshot=(ref,cb)=>{cb({docs:ref==='users'?users.map(r=>({id:r.id,data:()=>r.data})):[]});return()=>{};};export const getDocs=async()=>({docs:[]});export const getDoc=async()=>({exists:()=>false});export const addDoc=async()=>{};export const updateDoc=async()=>{};export const writeBatch=()=>({update(){},set(){},commit:async()=>{}});export const serverTimestamp=()=>0;export const Timestamp={fromMillis:n=>n};export const query=(r)=>r;export const limit=()=>0;export const orderBy=()=>0;`});
   }
   if(u.origin!==origin)return route.abort();
   if(/auth-guard\.js|admin-only-auth\.js|profile-manager\.js/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
   if(u.pathname==='/firebase/firebase-config.js')return route.fulfill({contentType:'text/javascript',body:'export const auth={currentUser:{uid:"admin",getIdToken:async()=>"fixture-admin"}};export const db={};export const appCheck=null;export const functions={};'});
   if(u.pathname==='/shared/security-client.js')return route.fulfill({contentType:'text/javascript',body:'export {auth} from "/firebase/firebase-config.js";export const callSecure=async(name,data)=>{if(name==="getElectionContext")return{electionId:"synthetic"};directoryWrites.push({name,data});return{updated:true};};'});
   return route.continue();
  });
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.type()==='prompt'?d.accept('Synthetic approved term completion'):d.accept());
  await p.goto(origin+'/usc-admin/admin-dashboard/queue.html');await p.waitForURL('**/users.html');
  await p.locator('[data-open-user="first"]').waitFor();
  await p.screenshot({path:path.join(out,'directory-desktop.png'),fullPage:true});
  await p.locator('[data-open-user="first"]').click();
  assert.equal(await p.locator('#targetRoleSelect').isDisabled(),true);assert.equal(await p.locator('#officePositionInput').isDisabled(),true);
  assert.equal(await p.getByRole('link',{name:'Register student account'}).getAttribute('href'),'../student-registration/student-registration.html');assert.equal(await p.locator('a[href="queue.html"]').count(),0);
  await p.locator('#adminNotesInput').fill('Synthetic directory note');await p.locator('#saveRoleButton').click();
  await p.waitForFunction(()=>directoryWrites.length===1);
  const write=await p.evaluate(()=>directoryWrites[0]);
  for(const key of ['role','officePosition','officerPermissions','officerPermissionSource','roleEffectiveDate'])assert.equal(Object.hasOwn(write.data,key),false);
  await p.screenshot({path:path.join(out,'directory-account-desktop.png')});
  await p.locator('#demoteToStudentButton').click();await p.waitForURL('**/officer-management.html?studentId=990001');await p.locator('#candidateSummary').filter({hasText:'990001'}).waitFor();
  assert.equal(await p.locator('#candidateStudentId').inputValue(),'990001');
  await p.locator('#registeredOfficerRows').getByText('No registered USC officers found.').waitFor();
  f.seed({uid:'legacy',studentId:'990009',fullName:'Synthetic <img src=x> Legacy Officer',role:'officer',officePosition:'Secretary',college:'College of Engineering',accountStatus:'suspended',isActive:false,studentStanding:'active'});
  await p.locator('#refreshHistory').click();await p.locator('[data-officer-uid="legacy"]').waitFor();
  assert.match(await p.locator('[data-officer-uid="legacy"]').innerText(),/No term recorded/);
  assert.match(await p.locator('[data-officer-uid="legacy"]').innerText(),/Suspended/);
  assert.equal(await p.locator('#registeredOfficerRows img').count(),0);
  f.records.get('users/legacy').fullName='Synthetic Legacy Officer';

  await p.locator('#assignmentPosition').selectOption('Treasurer');await p.locator('#administrationPeriod').fill('2026–2027');await p.locator('#appointmentAuthorization').fill('Synthetic authorized resolution');
  assert.equal(await p.locator('#inductionDate').count(),0);await p.locator('#termStart').fill('2026-11-20T09:15');assert.equal(await p.locator('#termEnd').inputValue(),'March 2027');await p.locator('#administrationPeriod').fill('2027-2028');assert.equal(await p.locator('#termEnd').inputValue(),'March 2028');await p.locator('#administrationPeriod').fill('2026–2027');assert.equal(await p.locator('#termEnd').inputValue(),'March 2027');assert.equal(await p.locator('#termEnd').getAttribute('readonly'), '');assert.ok(await p.locator('#termEnd').inputValue());await p.locator('#appointmentConfirmed').check();
  const count=f.authUsers.size;await p.getByRole('button',{name:'Create officer assignment'}).click();await p.getByText('Assignment created. Ask the officer to sign out and sign in again.').waitFor();
  assert.equal(f.records.get('users/first').role,'officer');assert.equal(f.authUsers.size,count);
  const term=f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId);
  assert.equal(term.termPolicy,'until-turnover');assert.equal(term.expectedEndMonth,'2027-03');assert.equal(term.expectedEndsAtMs,null);assert.equal(term.actualEndsAtMs,null);
  await p.locator('#assignmentList').getByText('Active',{exact:true}).waitFor();
  // Explicit administrator adoption is required for old hard-cutoff records.
  delete term.termPolicy;delete term.expectedEndMonth;term.endsAtMs=f.now+30*86400000;term.expectedEndsAtMs=term.endsAtMs;
  await p.locator('#refreshHistory').click();
  const policyButton=p.getByRole('button',{name:'Adopt expected-end policy'}),policyOutput=p.locator('[data-policy-status]');
  forceStaleAuth=true;
  await policyButton.click();await policyOutput.getByText('Sign out and sign in again before changing officer assignments, then retry.',{exact:true}).waitFor();
  const failedBox=await policyOutput.boundingBox();assert.ok(failedBox&&failedBox.y>=0&&failedBox.y<1000);
  assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).termPolicy,undefined);
  assert.equal(await policyButton.isVisible(),true);await p.screenshot({path:path.join(out,'policy-error-beside-button.png')});
  forceStaleAuth=false;
  let policyMode='no-op';
  await p.route('**/api/management',route=>{
   const request=route.request().postDataJSON();
   if(policyMode==='no-op'&&request.action==='officerAssignmentManage'&&request.data.action==='adopt-policy')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{id:request.data.assignmentId}})});
   if(policyMode==='read-fail'&&request.action==='officerAssignments'&&request.data.assignmentId)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'Synthetic verification read unavailable.'}})});
   return route.continue();
  });
  await policyButton.click();await policyOutput.getByText(/The service did not confirm the term schedule change/).waitFor();
  assert.equal(await policyButton.isVisible(),true);assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).termPolicy,undefined);
  policyMode='read-fail';
  await policyButton.click();await policyOutput.getByText(/saved change could not be verified/).waitFor();
  const savedPolicy={...f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId)};
  assert.equal(savedPolicy.termPolicy,'until-turnover');assert.equal(await policyButton.isVisible(),true);
  policyMode='none';f.advance(60000);
  await policyButton.click();await p.getByText('Expected-end policy adopted. Access continues until the term is completed.').waitFor();
  assert.equal(await policyButton.count(),0);assert.match(await policyOutput.innerText(),/Term schedule saved. Expected end: March 2027/);
  assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).policyAdoptedAtMs,savedPolicy.policyAdoptedAtMs);
  assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).policyReason,savedPolicy.policyReason);
  await p.locator('#assignmentList').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'policy-confirmed-button-removed.png')});
  await p.reload();await p.getByText('Authorized assignments loaded. Select a term to review its tracklist.').waitFor();
  assert.equal(await policyButton.count(),0);assert.match(await p.locator('#assignmentList').innerText(),/Expected end: March 2027/);
  assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).termPolicy,'until-turnover');assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).policyAdoptedBy,'admin');
  await p.locator('[data-officer-uid="first"]').waitFor();
  assert.match(await p.locator('[data-officer-uid="first"]').innerText(),/2026–2027/);
  await p.locator('#registeredOfficersPanel').screenshot({path:path.join(out,'registered-officers-table.png')});

  for(const width of [1440,768,390]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const fields=await p.locator('#appointmentForm .history-grid input, #appointmentForm .history-grid select').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:r.height,size:parseFloat(s.fontSize),weight:Number(s.fontWeight)};}));
   for(const field of fields){assert.equal(field.height,44);assert.ok(field.size<=16);assert.equal(field.weight,400);}
   const lookup=await p.locator('.history-candidate-search').evaluate(el=>{const a=el.querySelector('input').getBoundingClientRect(),b=el.querySelector('button').getBoundingClientRect();return {input:a.y,button:b.y};});
   assert.equal(lookup.input,lookup.button);
   if(width===390){await p.locator('.history-officer-table-scroll').evaluate(el=>el.scrollLeft=el.scrollWidth);assert.ok(await p.locator('.history-officer-table-scroll').evaluate(el=>el.scrollLeft>0));await p.locator('.history-officer-table-scroll').evaluate(el=>el.scrollLeft=0);}
   await p.screenshot({path:path.join(out,`officer-management-${width}.png`),fullPage:true});await p.locator('#termStart').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,`officer-term-form-${width}.png`),fullPage:true});}
  await p.getByRole('button',{name:'Complete term'}).click();await p.getByText('Term completed. Historical records are preserved; the outgoing officer must sign in again.').waitFor();
  assert.equal(f.records.get('officer_assignments/'+f.records.get('users/first').officerAssignmentId).actualEndsAtMs,f.now);assert.match(await p.locator('#assignmentList').innerText(),/Deactivation reason: Synthetic approved term completion/);assert.equal(f.records.get('users/first').role,'student');assert.deepEqual(f.records.get('users/first').officerPermissions,[]);assert.equal(f.authUsers.size,count);
  await p.locator('[data-officer-uid="first"]').waitFor({state:'detached'});await p.locator('#assignmentList').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'completed-term-mobile.png')});
  assert.equal(await p.locator('[data-officer-uid="legacy"]').count(),1);
  let failRoster=true;
  await p.route('**/api/management',route=>route.request().postDataJSON().action==='officerDirectory'&&failRoster?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetic roster unavailable'}})}):route.continue());
  await p.locator('#refreshHistory').click();await p.locator('#registeredOfficerStatus').getByText('Synthetic roster unavailable Use Refresh to retry.').waitFor();
  assert.equal(await p.locator('#registeredOfficerRows tr').count(),0);
  failRoster=false;await p.locator('#refreshHistory').click();await p.locator('[data-officer-uid="legacy"]').waitFor();
  for(let n=0;n<51;n++)f.seed({uid:'more'+String(n).padStart(3,'0'),studentId:String(880000+n),fullName:'Synthetic Officer '+n,role:'officer',officePosition:'Secretary',accountStatus:'approved',isActive:true,studentStanding:'active'});
  await p.locator('#refreshHistory').click();await p.locator('#moreRegisteredOfficers').waitFor({state:'visible'});
  await p.locator('#moreRegisteredOfficers').click();await p.waitForFunction(()=>document.querySelectorAll('#registeredOfficerRows tr').length===52);
  assert.equal(await p.locator('#registeredOfficerCount').innerText(),'52 officers');
  assert.equal(await p.locator('#registeredOfficerRows tr').evaluateAll(rows=>new Set(rows.map(row=>row.dataset.officerUid)).size),52);

  await p.goto(origin+'/usc-admin/student-registration/officer-registration.html');await p.waitForURL('**/officer-management.html');await p.locator('#appointmentForm').waitFor();
  await p.goto(origin+'/usc-admin/admin-dashboard/users.html');await p.locator('[data-open-user="first"]').click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:path.join(out,'directory-account-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: inline stale-auth error, no-op detection, failed verification read, idempotent retry, button removal after persisted conversion and reload; March end from academic year despite November start, academic-year changes, Philippine timezone, read-only end, delayed turnover, explicit legacy adoption and actual end/reason; retired routes redirect; directory retains student registration with read-only officer scope; account updates omit role fields; Student ID handoff; promotion and term completion preserve UID; roster handles legacy/restricted accounts, safe text, pagination, refresh, errors and mobile scrolling; 1440/768/390 responsive layouts; no browser errors. Synthetic data only.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
