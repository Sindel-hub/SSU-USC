// Exercise the real shared link renderer against the officer and student styles.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=process.env.USC_REVIEW_OUTPUT||'/tmp/announcement-inline-links';fs.mkdirSync(out,{recursive:true});
const sources={officer:'/usc-admin/overview/overview.html',student:'/dashboard/dashboard.html'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),surface=url.searchParams.get('surface');
 if(url.pathname==='/fixture'&&sources[surface]){
  const original=fs.readFileSync(path.join(root,sources[surface]),'utf8');
  const links=[...original.matchAll(/<link\b[^>]*>/g)].map(m=>m[0]).filter(tag=>/rel=["']stylesheet["']/.test(tag)).map(tag=>tag.replace(/href=["']([^"']+)["']/,(_,href)=>`href="${new URL(href,'http://'+req.headers.host+sources[surface]).href}"`)).join('\n');
  const body=surface==='officer'?'officer-reference-dashboard officer-app-shell':'student-app-shell';
  res.setHeader('Content-Type','text/html');return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${links}</head><body class="${body}"><main class="overview-content-grid" style="display:block;padding:16px;max-width:460px;margin:auto"><article class="bulletin-preview-card announcement-card" id="officerBulletinPreview"><div class="bulletin-copy announcement-card-body"><time>Announcement</time><h3>Stay connected with SSU Student Council</h3><p id="description"></p><a href="#details" id="readMore">Read more</a></div></article></main></body></html>`);
 }
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();const errors=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base)return route.continue();return route.fulfill({contentType:'text/html',body:'Linked destination'});});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const surface of ['officer','student'])for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});await page.goto(base+'/fixture?surface='+surface);
   const href='https://example.invalid/survey/index.html?id=LongSurveyIdentifier123456789';
   await page.evaluate(async href=>{const {attachSurveyButton}=await import('/shared/survey-links.mjs');const host=document.getElementById('description');host.textContent='Student feedback helps shape our plans.\n\n'+href;attachSurveyButton(host,{});},href);
   const link=page.locator('#description a');await link.waitFor();
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#description a')).display==='inline');
   const style=await link.evaluate(el=>{const s=getComputedStyle(el);return {display:s.display,background:s.backgroundColor,border:s.borderTopWidth,padding:s.paddingTop,minHeight:s.minHeight};});
   assert.deepEqual(style,{display:'inline',background:'rgba(0, 0, 0, 0)',border:'0px',padding:'0px',minHeight:'0px'});
   assert.equal(await link.getAttribute('href'),href);assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;await popup.waitForLoadState();assert.equal(popup.url(),href);await popup.close();
   await page.screenshot({path:path.join(out,`${surface}-${width}.png`),fullPage:true});
   // Legacy dedicated survey metadata is now an inline URL, with no duplicate CTA.
   await page.evaluate(async()=>{const {attachSurveyButton}=await import('/shared/survey-links.mjs');const host=document.getElementById('description');host.textContent='Please send your feedback.';attachSurveyButton(host,{surveyId:'A'.repeat(20)});if(host.querySelectorAll('a').length!==1||host.querySelector('a').target!=='_blank'||!host.querySelector('a').textContent.includes('/survey/index.html?id='))throw Error('Legacy link not preserved inline');host.textContent='Feedback: '+new URL('/survey/index.html?id='+'A'.repeat(20),location.href).href;attachSurveyButton(host,{surveyId:'A'.repeat(20)});if(host.querySelectorAll('a').length!==1)throw Error('Duplicate survey link');});
  }
  assert.deepEqual(errors,[]);console.log('PASS: plain inline links under real officer/student styles at 1440/390; long URL wrapping; new-tab destination; legacy survey URLs and deduplication.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
