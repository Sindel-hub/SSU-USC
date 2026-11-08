// Actual student registration module + synthetic, isolated service responses.
const {chromium}=require(process.env.SSU_PLAYWRIGHT_MODULE||'playwright');const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.SSU_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});let records={},verified=false,submitted=0,uploads=0,closed=false;const errors=[];
 const profile={uid:'student',role:'student',fullName:'Synthetic Student',studentId:'123',accountStatus:'approved',isActive:true,candidacyApproved:true,schoolProvisioned:true,isVerifiedStudent:true,college:'Arts'};
 page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('fixtureRead',()=>records);await page.exposeFunction('fixtureWrite',value=>{records=value});
 await page.addInitScript(profile=>{window.USC_AUTH_READY=Promise.resolve(true);sessionStorage.setItem('studentProfile',JSON.stringify(profile));window.profileRequests=0;window.addEventListener('usc:open-profile-email',()=>{window.profileRequests++})},profile);
 const sdk=`window.fixtureRecords=await window.fixtureRead();const snap=path=>({id:path.split('/').pop(),exists:()=>Boolean(window.fixtureRecords[path]),data:()=>window.fixtureRecords[path]});export const doc=(db,...parts)=>parts.join('/');export const collection=(db,...parts)=>parts.join('/');export const getDoc=async path=>path==='users/student'?{exists:()=>true,data:()=>(${JSON.stringify(profile)})}:snap(path);export const getDocs=async()=>({docs:[]});export const onSnapshot=(path,next)=>{next(snap(path));return()=>{}};export const setDoc=async(path,data)=>{window.fixtureRecords[path]=data;await window.fixtureWrite(window.fixtureRecords)};export const deleteDoc=async path=>{delete window.fixtureRecords[path];await window.fixtureWrite(window.fixtureRecords)};export const signOut=async()=>{};`;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/firebase/firebase-config.js'))return route.fulfill({contentType:'text/javascript',body:'export const db={};export const auth={currentUser:{uid:"student",getIdToken:async()=>"synthetic-token"}};'});
  if(url.pathname.endsWith('/shared/security-client.js'))return route.fulfill({contentType:'text/javascript',body:`export async function callSecure(name,data){return window.fixtureCall(name,data)}export async function secureUpload(file,kind){return window.fixtureCall('upload',{kind,name:file.name})}export const hydrateMediaImages=async()=>{};export const resolveMediaUrl=async()=>'/dashboard/assets/USClogo.webp';`});
  if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url.pathname.endsWith('/functions/v1/usc-email')){
   const body=route.request().postDataJSON();if(['candidate_email_status','verified_email_status'].includes(body.action))return route.fulfill({json:{ok:true,verified}});return route.fulfill({status:400,json:{ok:false}});
  }
  if(url.hostname!=='candidate.test')return route.abort();const file=path.join(root,url.pathname);if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
  let body=fs.readFileSync(file);const ext=path.extname(file);if(ext==='.html')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'}[ext]||'text/plain',body});
 });
 await page.exposeFunction('fixtureCall',async(name,data)=>{
  if(name==='upload'){uploads++;return {path:'firestore-media://synthetic-'+uploads}};
  if(name==='submitCandidateApplication'){assert.equal(verified,true);submitted++;records['elections/B/applications/student']={...data,applicantUid:'student',status:'Under Review'};return {status:'Under Review'}}
  if(name==='getElectionContext')return {electionId:'B',title:'Synthetic Election',lifecycle:closed?'Review':'Registration',scheduleComplete:true,registrationOpen:!closed,reviewOpen:closed,candidateVisible:false,votingOpen:false,resultsVisible:false};throw Error('Unexpected action '+name);
 });
 async function open(){await page.goto('https://candidate.test/dashboard/election.html');await page.addScriptTag({type:'module',url:'https://candidate.test/dashboard/js/election.js'});}
 await open();await page.locator('#landingApplication').click();await page.locator('#candidateNext').click();await page.locator('#candidatePosition').selectOption('President');await page.locator('#candidateParty').fill('Independent');
 await page.locator('input[type=file]').first().setInputFiles({name:'campaign.png',mimeType:'image/png',buffer:Buffer.from('synthetic-image')});await page.locator('#candidateNext').click();await page.locator('#candidatePlatform').fill('A saved platform');await page.locator('#candidateStatement').fill('A saved statement');
 await page.locator('#supportingDocuments').setInputFiles({name:'supporting.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic-document')});await page.locator('#candidateNext').click();
 await page.locator('#submitCandidateApplication').click();await page.getByRole('dialog',{name:'Email Verification Required'}).waitFor();assert.equal(submitted,0);assert.equal(uploads,0);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:800});if(width===390&&process.env.SSU_EMAIL_POPUP_SCREENSHOT)await page.screenshot({path:process.env.SSU_EMAIL_POPUP_SCREENSHOT});assert.ok(await page.locator('dialog.candidate-email-required').evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().left>=0));}
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.match(await page.locator('.candidate-review-text').textContent(),/A saved platform/);
 await page.locator('#submitCandidateApplication').click();await page.getByRole('button',{name:'Connect Gmail / Institutional Email'}).click();await page.waitForFunction(()=>window.profileRequests===1);assert.equal(submitted,0);assert.equal(uploads,2);
 assert.equal(records['candidate_registration_drafts/student/elections/B'].platform,'A saved platform');assert.doesNotMatch(JSON.stringify(records),/synthetic-document|synthetic-image/);
 await open();await page.locator('#submitCandidateApplication').waitFor();assert.match(await page.locator('.candidate-review-text').textContent(),/A saved statement/);verified=true;
 await page.locator('#submitCandidateApplication').click();await page.locator('#applicationSuccess:not(.hidden)').waitFor();assert.equal(submitted,1);assert.equal(uploads,2);assert.equal(records['candidate_registration_drafts/student/elections/B'],undefined);
 // A closed window restores no actionable form and never submits its saved draft.
 delete records['elections/B/applications/student'];records['candidate_registration_drafts/student/elections/B']={electionId:'B',platform:'Expired application',statement:'Saved',expiresAtMs:Date.now()+60000};closed=true;await open();await page.getByText('Registration closed while you were away. Your draft was not submitted.').waitFor();assert.equal(await page.locator('#submitCandidateApplication').count(),0);assert.equal(submitted,1);
 closed=false;delete records['candidate_registration_drafts/student/elections/B'];records['candidate_registration_drafts/student/elections/A']={electionId:'A',platform:'A draft',statement:'Saved',expiresAtMs:Date.now()+60000};await page.evaluate(()=>sessionStorage.setItem('candidateDraftElection:student','A'));await open();await page.getByText('Your saved application belongs to a different election. It has not been submitted.').waitFor();assert.equal(await page.locator('#submitCandidateApplication').count(),0);assert.equal(submitted,1);
 assert.deepEqual(errors,[]);await browser.close();console.log('Verified email popup, cancel, profile handoff, secure draft reload, verified resume, closed-window protection and mobile sizing passed');
})().catch(error=>{console.error(error);process.exit(1)});
