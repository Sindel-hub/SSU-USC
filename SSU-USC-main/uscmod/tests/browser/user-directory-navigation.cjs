// Real pages/controllers with synthetic Auth/Firestore and actual management HTTP handlers.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {historyFixture}=require('../helpers/officer-history-fixture.cjs');
const {createManagementHTTPHandler}=require('../../server/http.cjs');
const root=path.resolve(__dirname,'../..'),out=process.env.USC_REVIEW_OUTPUT||'/tmp/user-directory-review';
fs.mkdirSync(out,{recursive:true});
const f=historyFixture();let origin;
const api=createManagementHTTPHandler({hosted:false,log(){},getRuntime:()=>({settings:{allowedOrigins:new Set([origin])},handlers:f.h,verifyIdToken:async()=>({uid:'admin',role:'admin',email_verified:true,auth_time:f.now/1000})})});
const server=http.createServer((req,res)=>{const u=new URL(req.url,origin);if(u.pathname==='/api/management')return api(req,res);const file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(let n=0;n<70;n++)f.seed({uid:'sample'+String(n).padStart(3,'0'),studentId:String(770000+n),fullName:'Sample Student '+String(n+1).padStart(2,'0'),role:'student',accountStatus:'approved',isActive:true,studentStanding:'active'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
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
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/usc-admin/admin-dashboard/users.html');await p.locator('[data-account-name="first"]').waitFor();
  const modal=p.locator('#userEditorModal');
  const closed=async()=>assert.equal(await modal.getAttribute('aria-hidden'),'true');
  const opened=async()=>{await p.locator('#selectedUserName').filter({hasText:'Synthetic first'}).waitFor();assert.equal(await modal.getAttribute('aria-hidden'),'false');};
  const positions=()=>p.evaluate(()=>({main:document.querySelector('.main').scrollTop,table:document.querySelector('#directoryTableScroll').scrollTop,left:document.querySelector('#directoryTableScroll').scrollLeft}));
  await p.locator('[data-account-row="first"] td').nth(2).scrollIntoViewIfNeeded();
  const before=await positions();
  await p.locator('[data-account-row="first"] td').nth(2).dblclick();await opened();await p.keyboard.press('Escape');await closed();assert.deepEqual(await positions(),before);
  assert.equal(await p.locator('[data-account-name="first"]').evaluate(e=>e===document.activeElement),true);
  await p.locator('[data-account-name="first"]').press('Enter');await opened();await p.locator('#userEditorModalClose').click();await closed();
  await p.locator('[data-user-id="first"]').check();await closed();assert.equal(await p.locator('[data-user-id="first"]').isChecked(),true);
  await p.locator('[data-user-id="first"]').dblclick();await closed();
  const nameX=await p.locator('[data-account-name="first"]').evaluate(e=>e.getBoundingClientRect().x);
  await p.locator('#directoryHorizontalScroll').focus();await p.keyboard.press('End');
  await p.waitForFunction(()=>document.querySelector('#directoryTableScroll').scrollLeft>0);
  assert.equal(await p.locator('[data-account-name="first"]').evaluate(e=>e.getBoundingClientRect().x),nameX);
  await p.locator('#directoryTableScroll').evaluate(e=>e.scrollLeft=100);
  await p.waitForFunction(()=>Math.abs(Number(document.querySelector('#directoryHorizontalScroll').value)-document.querySelector('#directoryTableScroll').scrollLeft)<2);
  await p.locator('#directoryTableScroll').evaluate(e=>{e.scrollLeft=0;e.scrollTop=e.scrollHeight;});
  assert.ok(await p.locator('#directoryTableScroll').evaluate(e=>e.scrollTop>0));
  const header=await p.locator('#directoryTableScroll thead').evaluate(e=>e.querySelector('th').getBoundingClientRect().y);
  const tableTop=await p.locator('#directoryTableScroll').evaluate(e=>e.getBoundingClientRect().y);
  assert.ok(Math.abs(header-tableTop)<3);assert.equal((await positions()).main,before.main);
  await p.locator('#directoryTableScroll').evaluate(e=>e.scrollTop=0);
  await p.locator('#userSearchInput').fill('990001');await p.waitForFunction(()=>document.querySelectorAll('#usersTableBody tr').length===1);
  assert.equal(await p.locator('[data-account-row="first"]').count(),1);
  const downloadEvent=p.waitForEvent('download');await p.locator('#exportFilteredButton').click();const download=await downloadEvent;
  const exportPath=path.join(out,'synthetic-filtered-accounts.csv');await download.saveAs(exportPath);
  assert.match(fs.readFileSync(exportPath,'utf8'),/990001/);assert.doesNotMatch(fs.readFileSync(exportPath,'utf8'),/770000/);
  await p.locator('#userSearchInput').fill('');await p.waitForFunction(()=>document.querySelectorAll('#usersTableBody tr').length===74);
  await p.locator('#sortSelect').selectOption('role');
  for(const width of [1440,768,390]){
   await p.setViewportSize({width,height:1000});await p.locator('#directoryTableScroll').evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await p.screenshot({path:path.join(out,`user-directory-${width}.png`),fullPage:true});
  }
  await p.locator('[data-account-row="first"]').scrollIntoViewIfNeeded();
  // Disable compatibility dblclick to verify that real touch events use the double-tap path.
  await p.evaluate(()=>{window.blockDoubleClick=e=>e.stopImmediatePropagation();document.addEventListener('dblclick',window.blockDoubleClick,true);});
  const cell=await p.locator('[data-account-row="first"] td').nth(1).boundingBox();
  const point={x:cell.x+12,y:cell.y+cell.height-6};
  await p.touchscreen.tap(point.x,point.y);await closed();await p.touchscreen.tap(point.x,point.y);await opened();
  await p.keyboard.press('Escape');await closed();
  await p.evaluate(()=>document.removeEventListener('dblclick',window.blockDoubleClick,true));
  await p.locator('#directoryTableScroll').evaluate(e=>e.scrollTop=0);
  await p.locator('#directoryTableScroll').scrollIntoViewIfNeeded();
  const scrollBeforeTouch=await p.locator('#directoryTableScroll').evaluate(e=>e.scrollTop);
  const cdp=await context.newCDPSession(p);const bounds=await p.locator('#directoryTableScroll').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+100,y:bounds.y+180}]});await p.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+100,y:bounds.y+110}]});await p.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+100,y:bounds.y+70}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await closed();
  await p.waitForFunction(before=>document.querySelector('#directoryTableScroll').scrollTop>before,scrollBeforeTouch);
  await p.locator('#directoryTableScroll').evaluate(e=>{e.scrollLeft=0;e.scrollTop=0;});
  await p.locator('[data-account-name="first"]').click();await opened();await p.locator('#suspendUserButton').waitFor();await p.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log('PASS: 74-account directory; mouse double-click, native touch double-tap, name/keyboard access, checkbox isolation, touch scrolling, modal focus/scroll restoration, synchronized top handle, pinned names/sticky headers, search/sort and 1440/768/390 layouts. Synthetic data only.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
