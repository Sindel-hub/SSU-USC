// Real interface + real service handlers against isolated in-memory Auth/Firestore doubles.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {fixture}=require('../helpers/student-records-fixture.cjs');const f=fixture();
const root=path.resolve(__dirname,'../..'),out=process.env.USC_REVIEW_OUTPUT||'/tmp/student-import-correction-review';fs.mkdirSync(out,{recursive:true});
const existing={studentId:'000123',uid:'existing-student',fullName:'Synthetic Continuing Student',college:'College of Engineering',program:'Bachelor of Science in Civil Engineering',yearLevel:'1',academicYear:'2026-2027',studentStanding:'active',enrollmentStatus:'Enrolled',institutionalEmail:'continuing@example.invalid',email:'continuing@example.invalid',accountStatus:'approved',isActive:true,isVerifiedStudent:true,candidacyApproved:true,role:'officer',officePosition:'President'};
f.seed(existing,{password:'Existing-secret-password'});f.seed({...existing,studentId:'000125',uid:'omitted-student',fullName:'Synthetic Student Awaiting Annual Review',email:'review@example.invalid',institutionalEmail:'review@example.invalid'});
f.records.set('complaints/fixture-complaint',{studentUid:existing.uid,subject:'Synthetic student service request',status:'In Progress',createdAt:f.now});f.records.set('student_signin_stats/'+existing.uid,{signInCount:7,lastSignInAt:f.now});f.records.set('events/fixture-event/registrations/'+existing.uid,{studentUid:existing.uid,status:'registered',registeredAt:f.now});
const header='Student ID,Last Name,First Name,Middle Name,Suffix,College Department,Course / Program,Year Level,Enrollment Status,Institution Email (Optional)\n';
const rows=['000123,Student,Synthetic Continuing,,,College of Engineering,Bachelor of Science in Civil Engineering,2,Regular,continuing@example.invalid','000124,Student,Synthetic New,,,College of Arts and Sciences (CAS),Bachelor of Information Technology,1,Regular,','000126,Student,Email Pending,,,College of Engineering,Bachelor of Science in Civil Engineering,1,Irregular,'];
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/fixture-call'){let body='';for await(const chunk of req)body+=chunk;try{const {name,data}=JSON.parse(body);const result=await f.handlers[name]({...f.admin,data});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;}
 const p=path.join(root,url.pathname);if(!p.startsWith(root+'/')||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':/\.(js|mjs|cjs)$/.test(p)?'text/javascript':p.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(fs.readFileSync(p));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila'});const errors=[],network=[];
 await context.addInitScript(()=>{globalThis.USC_AUTH_READY=Promise.resolve(true);sessionStorage.setItem('studentProfile',JSON.stringify({role:'admin',fullName:'Synthetic Administrator'}));});
 await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==base){network.push(u.origin);return route.abort();}
 if(/auth-guard\.js|admin-only-auth\.js|profile-manager\.js/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
 if(u.pathname==='/shared/needs-assessment-client.js'){const source=fs.readFileSync(path.join(root,u.pathname),'utf8');return route.fulfill({contentType:'text/javascript',body:source.slice(source.indexOf('export const escapeHtml'))});}
 if(u.pathname==='/shared/student-records-client.js')return route.fulfill({contentType:'text/javascript',body:`export async function studentRecordCall(name,data={}){const r=await fetch('/fixture-call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}`});return route.continue();});
 const admin=await context.newPage();admin.on('pageerror',e=>errors.push(e.message));admin.on('dialog',d=>d.accept());
 await admin.goto(base+'/usc-admin/admin-dashboard/student-records.html');await admin.locator('[data-student="000123"]').waitFor();
 const csvHeader=header.trim()+',Student Status\n';
 const csv=status=>csvHeader+'000123,Student,Synthetic Continuing,,,College of Engineering,Bachelor of Science in Civil Engineering,3,Regular,continuing@example.invalid,'+status+'\n';
 const upload=status=>admin.locator('#studentImportFile').setInputFiles({name:'synthetic-students.csv',mimeType:'text/csv',buffer:Buffer.from(csv(status))});
 await admin.locator('#importYear').fill('2027-2028');await upload('Dropped');await admin.locator('#importAuthorized').check();
 await admin.getByRole('button',{name:'Validate and preview',exact:true}).click();await admin.locator('#importPreviewRows').getByText('Mark dropped · disable access',{exact:true}).waitFor();
 assert.equal(f.authUsers.get(existing.uid).disabled,false);
 await admin.locator('#confirmImport').check();await admin.locator('#applyStudentImport').click();await admin.getByText('Ready records applied.',{exact:true}).waitFor();
 assert.equal(f.records.get('users/'+existing.uid).studentStanding,'dropped');assert.equal(f.authUsers.get(existing.uid).disabled,true);assert.equal(f.authUsers.get(existing.uid).revoked,true);
 await admin.locator('#studentStatusFilter').selectOption('dropped');await admin.locator('#studentRecordRows').getByText('Dropped',{exact:true}).waitFor();
 await admin.locator('#importYear').fill('2026-2027');await upload('Undergraduate');await admin.getByRole('button',{name:'Validate and preview',exact:true}).click();
 await admin.locator('#reviewImportTab').click();await admin.locator('#importPreviewRows').getByText('This import is older than the student’s current academic year.').waitFor();
 assert.equal(await admin.locator('#applyStudentImport').isDisabled(),true);
 await admin.locator('details.file-guide').filter({hasText:'Correct an earlier year / recover a test import'}).locator('summary').click();
 await admin.locator('#correctionMode').check();await admin.locator('#correctionReason').fill('Recover from the synthetic future-year test import');await admin.locator('#restoreImportAccess').check();
 await admin.getByRole('button',{name:'Validate and preview',exact:true}).click();await admin.locator('#importPreviewRows').getByText('Correct record & restore access',{exact:true}).waitFor();
 assert.equal(f.authUsers.get(existing.uid).disabled,true);assert.match(await admin.locator('#importReference').innerText(),/CORRECTION/);assert.equal(await admin.locator('#importProgress').innerText(),'');
 await admin.screenshot({path:path.join(out,'correction-preview-desktop.png'),fullPage:true});
 await admin.locator('#importPreview').screenshot({path:path.join(out,'correction-ready-review.png')});
 await admin.locator('#confirmImport').check();await admin.locator('#applyStudentImport').click();await admin.getByText('Ready records applied.',{exact:true}).waitFor();
 const profile=f.records.get('users/'+existing.uid);assert.equal(profile.academicYear,'2026-2027');assert.equal(profile.role,'officer');assert.equal(profile.officePosition,'President');assert.equal(profile.isActive,true);assert.equal(profile.isVerifiedStudent,false);assert.equal(profile.candidacyApproved,false);
 assert.equal(f.authUsers.get(existing.uid).disabled,false);assert.equal(f.authUsers.get(existing.uid).password,'Existing-secret-password');assert.equal(f.authUsers.get(existing.uid).customClaims.role,'officer');
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('users/'+existing.uid+'/academic_history/')).length,2);assert.equal(f.records.get('users/omitted-student').isActive,true);
 await admin.locator('#studentStatusFilter').selectOption('');await admin.locator('[data-student="000123"]').click();await admin.locator('#studentAcademicHistory').getByText('2027-2028',{exact:false}).first().waitFor();
 assert.match(await admin.locator('#studentAcademicHistory').innerText(),/2026-2027/);await admin.locator('#closeStudentDetail').click();
 await admin.locator('#importYear').fill('2028-2029');assert.equal(await admin.locator('#importPreview').isVisible(),false);assert.equal(await admin.locator('#applyStudentImport').isDisabled(),true);
 for(const width of [768,390]){await admin.setViewportSize({width,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await admin.screenshot({path:path.join(out,`correction-controls-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);console.log('PASS: actual Student Records page accepts Dropped, blocks normal older imports, previews explicit correction/restoration, preserves President identity/password/history and omitted accounts, does not restore voting flags, invalidates changed previews, and fits desktop/tablet/mobile. Synthetic data only.');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
