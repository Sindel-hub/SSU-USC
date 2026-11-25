// Real pages/controllers with synthetic Auth/Firestore and actual management HTTP handlers.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {historyFixture}=require('../helpers/officer-history-fixture.cjs');
const {createManagementHTTPHandler}=require('../../server/http.cjs');
const root=path.resolve(__dirname,'../..'),out=process.env.USC_REVIEW_OUTPUT||'/tmp/officer-management-only';
fs.mkdirSync(out,{recursive:true});
const f=historyFixture();let origin;
const api=createManagementHTTPHandler({hosted:false,log(){},getRuntime:()=>({settings:{allowedOrigins:new Set([origin])},handlers:f.h,verifyIdToken:async()=>({uid:'admin',role:'admin',email_verified:true,auth_time:f.now/1000})})});
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
  assert.equal(await p.getByText('Register student account',{exact:true}).count(),0);assert.equal(await p.locator('a[href="queue.html"]').count(),0);
  await p.locator('#adminNotesInput').fill('Synthetic directory note');await p.locator('#saveRoleButton').click();
  await p.waitForFunction(()=>directoryWrites.length===1);
  const write=await p.evaluate(()=>directoryWrites[0]);
  for(const key of ['role','officePosition','officerPermissions','officerPermissionSource','roleEffectiveDate'])assert.equal(Object.hasOwn(write.data,key),false);
  await p.screenshot({path:path.join(out,'directory-account-desktop.png')});
  await p.locator('#demoteToStudentButton').click();await p.waitForURL('**/officer-management.html?studentId=990001');await p.locator('#candidateSummary').filter({hasText:'990001'}).waitFor();
  assert.equal(await p.locator('#candidateStudentId').inputValue(),'990001');
  await p.locator('#assignmentPosition').selectOption('Treasurer');await p.locator('#administrationPeriod').fill('Synthetic 2026–2027');await p.locator('#appointmentAuthorization').fill('Synthetic authorized resolution');
  await p.locator('#termStart').fill(new Date(f.now-60000).toISOString().slice(0,16));await p.locator('#termEnd').fill(new Date(f.now+86400000).toISOString().slice(0,16));await p.locator('#appointmentConfirmed').check();
  const count=f.authUsers.size;await p.getByRole('button',{name:'Create officer assignment'}).click();await p.getByText('Assignment created. Ask the officer to sign out and sign in again.').waitFor();
  assert.equal(f.records.get('users/first').role,'officer');assert.equal(f.authUsers.size,count);
  for(const width of [1440,768,390]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:path.join(out,`officer-management-${width}.png`),fullPage:true});}
  await p.getByRole('button',{name:'Complete term'}).click();await p.getByText('Term completed. Historical records are preserved; the outgoing officer must sign in again.').waitFor();
  assert.equal(f.records.get('users/first').role,'student');assert.deepEqual(f.records.get('users/first').officerPermissions,[]);assert.equal(f.authUsers.size,count);
  await p.goto(origin+'/usc-admin/student-registration/officer-registration.html');await p.waitForURL('**/officer-management.html');await p.locator('#appointmentForm').waitFor();
  await p.goto(origin+'/usc-admin/admin-dashboard/users.html');await p.locator('[data-open-user="first"]').click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:path.join(out,'directory-account-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: retired routes redirect; directory has no account creation or editable officer scope; account updates omit role fields; Student ID handoff; promotion and term completion preserve UID; 1440/768/390 responsive layouts; no browser errors. Synthetic data only.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
