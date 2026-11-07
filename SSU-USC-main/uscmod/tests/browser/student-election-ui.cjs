// Runs actual Election rendering and stylesheet assets with synthetic data only.
// All external requests and application backend calls are blocked.
// Requires Playwright and Chromium; USC_PLAYWRIGHT_MODULE / USC_CHROMIUM_PATH
// can select an existing test installation. Screenshots go to USC_UI_ARTIFACT_DIR.
const {chromium}=require(process.env.USC_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const artifacts=process.env.USC_UI_ARTIFACT_DIR || '/tmp/ssu-election-ui';
fs.mkdirSync(artifacts,{recursive:true});
let source=fs.readFileSync(root+'/dashboard/js/election.js','utf8');source=source.slice(source.indexOf('const app =')).split('await initialize();')[0];
const setup=`const hydrateMediaImages=async()=>{};const callSecure=async()=>{throw new Error('Network forbidden in UI fixture')};const secureUpload=callSecure;`;
const fixtures=`student={fullName:'Alexandra Maria Student Example',studentId:'TEST-001',college:'College of Engineering',program:'Bachelor of Science in Civil Engineering',email:'fixture@example.test',yearLevel:'4th Year',candidacyApproved:true};context={electionId:'fixture-election',title:'USC Election',lifecycle:'Registration',registrationOpen:true,candidateVisible:true,votingOpen:true,scheduleComplete:true,registrationStart:1789000000000,registrationEnd:1799000000000,votingStart:1800000000000,votingEnd:1800003600000};candidates=Array.from({length:7},(_,i)=>({id:'fixture-'+i,fullName:'Alexandra Maria Candidate '+(i+1),position:i<5?'President':'Vice President',partylist:'Independent',campaignPhotoUrl:'assets/USClogo.webp',platform:'Our plans for a more inclusive student council.\\n\\n'+('Transparent, accessible student services. '.repeat(45)),statement:'We aim to serve our fellow students.'}));window.fixture={landing:()=>renderLanding(),closed:()=>{context.registrationOpen=false;context.candidateVisible=false;context.votingOpen=false;context.lifecycle='Draft';renderLanding()},open:()=>{context.registrationOpen=true;context.candidateVisible=true;context.votingOpen=true;context.lifecycle='Registration';renderLanding()},register:step=>renderRegistration(step,true),gallery:()=>renderCandidates()};renderLanding();`;
(async()=>{const browser=await chromium.launch({executablePath:process.env.USC_CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});let errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{let u=new URL(route.request().url());if(u.hostname!=='election.test')return route.abort();let p=path.join(root,decodeURIComponent(u.pathname));if(!p.startsWith(root)||!fs.existsSync(p))return route.fulfill({status:404,body:''});let body=fs.readFileSync(p);let type={'.css':'text/css','.webp':'image/webp','.html':'text/html','.svg':'image/svg+xml'}[path.extname(p)]||'application/octet-stream';if(type==='text/html')body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');await route.fulfill({contentType:type,body});});
await page.goto('https://election.test/dashboard/election.html');await page.addScriptTag({content:setup+source+fixtures});await page.waitForTimeout(600);
await page.screenshot({path:artifacts+'/election-landing-desktop.png',fullPage:true});
await page.evaluate(()=>fixture.closed());await page.screenshot({path:artifacts+'/election-closed-mobile-check.png',fullPage:true});
await page.evaluate(()=>fixture.open());
await page.click('#landingApplication');
assert.ok(await page.locator('.candidate-registration-page').isVisible());
await page.click('#candidateNext');await page.selectOption('#candidatePosition','President');
await page.setInputFiles('#campaignPhoto',{name:'campaign-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1UAAAAASUVORK5CYII=','base64')});
await page.click('#candidateNext');await page.fill('#candidatePlatform','Plans for accessible services');await page.fill('#candidateStatement','I want to serve the student body.');
await page.setInputFiles('#supportingDocuments',{name:'enrollment.pdf',mimeType:'application/pdf',buffer:Buffer.from('fixture')});
await page.click('#candidateNext');await page.waitForTimeout(450);assert.equal(await page.locator('#candidateRegistrationProgress').getAttribute('aria-valuenow'),'100');
await page.click('#candidateBack');assert.match(await page.locator('.candidate-selected-docs').textContent(),/enrollment.pdf/);
await page.evaluate(()=>fixture.register(3));await page.waitForTimeout(500);await page.screenshot({path:artifacts+'/election-form-desktop.png',fullPage:true});
await page.fill('#candidatePlatform','A platform');await page.fill('#candidateStatement','A statement');await page.click('#candidateNext');assert.match(await page.locator('#candidateStepMessage').textContent(),/supporting document/);assert.equal(await page.locator('#candidateRegistrationProgress').getAttribute('aria-valuenow'),'43');
await page.setInputFiles('#supportingDocuments',{name:'enrollment.pdf',mimeType:'application/pdf',buffer:Buffer.from('fixture')});await page.waitForTimeout(500);assert.equal(await page.locator('#candidateRegistrationProgress').getAttribute('aria-valuenow'),'57');await page.click('#candidateNext');await page.waitForTimeout(500);assert.equal(await page.locator('#candidateRegistrationProgress').getAttribute('aria-valuenow'),'100');
await page.evaluate(()=>fixture.gallery());await page.waitForTimeout(600);await page.screenshot({path:artifacts+'/election-candidates-desktop.png',fullPage:true});let image=page.locator('.election-candidate-card img').first();let before=await image.boundingBox();await page.locator('.election-candidate-card').first().hover();await page.waitForTimeout(400);assert.deepEqual(await image.boundingBox(),before);assert.equal(await image.evaluate(el=>getComputedStyle(el).objectFit),'contain');
assert.ok(await page.locator('#backCandidates').isVisible());
const vote = await page.locator('#floatingVoteStatus').boundingBox(); const appBox = await page.locator('#electionApp').boundingBox();
assert.ok(Math.abs((vote.x+vote.width/2)-(appBox.x+appBox.width/2))<10,'Vote button centered');
await page.mouse.move(appBox.x+appBox.width/2,appBox.y+appBox.height/2); await page.mouse.wheel(0,600); await page.waitForTimeout(500);
const down = await page.locator('#electionApp').evaluate(el=>el.scrollTop); assert.ok(down>100,'Wheel scroll down');
await page.mouse.wheel(0,-600);await page.waitForTimeout(500);assert.ok(await page.locator('#electionApp').evaluate(el=>el.scrollTop)<down,'Wheel scroll up');
await page.locator('[data-scroll-position="1"]').click();await page.waitForTimeout(800);assert.ok(await page.locator('#electionApp').evaluate(el=>el.scrollTop)>down,'Position navigation');
await page.locator('[data-scroll-position="0"]').click();await page.waitForTimeout(800);

await page.locator('.election-candidate-card').first().click();await page.screenshot({path:artifacts+'/election-profile-desktop.png',fullPage:true});assert.equal(await page.locator('.candidate-profile-modal').evaluate(el=>getComputedStyle(el).overflowY),'visible');await page.keyboard.press('Escape');assert.equal(await page.locator('.candidate-profile-overlay').count(),0);
for(const width of [320,390,768]){await page.setViewportSize({width,height:844});for(const view of ['landing','register','gallery']){await page.evaluate(v=>{fixture.open();v==='register'?fixture.register(3):fixture[v]()},view);await page.waitForTimeout(500);let overflowing=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,appWidth:document.getElementById('electionApp').clientWidth,appScroll:document.getElementById('electionApp').scrollWidth}));if(view==='register')for(const step of [1,2,4]){await page.evaluate(s=>fixture.register(s),step);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} form step ${step} overflow`);} console.log(width,view,overflowing);assert.ok(overflowing.scroll<=width,`${width} ${view} horizontal overflow`);assert.ok(overflowing.appScroll<=overflowing.appWidth+1,`${width} ${view} app overflow`);if(width===390)await page.screenshot({path:artifacts+'/election-'+view+'-mobile.png',fullPage:true});}}
await page.setViewportSize({width:390,height:844});
await page.evaluate(()=>{fixture.open();fixture.gallery()});await page.locator('.election-candidate-card').first().click();
await page.locator('.candidate-profile-section').last().scrollIntoViewIfNeeded();
assert.ok(await page.locator('.candidate-profile-section').last().isVisible(),'Long profile content remains accessible');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile modal does not overflow horizontally');
await page.keyboard.press('Escape');assert.equal(await page.locator('.candidate-profile-overlay').count(),0);
await page.evaluate(()=>{fixture.open();fixture.gallery()});await page.locator('#electionApp').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));
const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:700}]});
for(let y=660;y>=420;y-=40){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y}]});await page.waitForTimeout(30)}
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(500);
assert.ok(await page.locator('#electionApp').evaluate(el=>el.scrollTop)>100,'Touch scroll on a candidate card');
await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#electionApp').evaluate(el=>getComputedStyle(el).scrollBehavior),'auto');
assert.equal(await page.locator('.election-candidate-card').first().evaluate(el=>getComputedStyle(el).opacity),'1');
console.log('Wheel up/down, position navigation, touch swipe, centered vote, reduced motion: passed');
console.log('Page errors',errors);assert.equal(errors.length,0);await browser.close();})();
