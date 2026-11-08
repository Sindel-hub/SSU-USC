const fs=require('node:fs'),path=require('node:path');
const production={firebaseProject:'universitystudentcouncil-856cc',supabaseUrl:'https://svgfxatigtjdrwzibjbu.supabase.co',firebaseKey:'AIzaSyAVu7wu_1JnWQFNmwWMQHly0JEXjXxnzjA'};
const skipped=new Set(['.git','node_modules','review-build','tests','scripts','functions','.vercel','.temp','docs']);
const gate=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staging setup required · SSU USC</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.6 system-ui,sans-serif;color:#264666;background:#eef6fc}main{max-width:620px;background:white;border:1px solid #d5e5f1;border-radius:22px;padding:32px;box-shadow:0 16px 50px #194f8910}small{color:#218fb9;font-weight:700;letter-spacing:.08em}h1{color:#194f89;font-size:28px;line-height:1.25}code{overflow-wrap:anywhere;font-size:13px}li{margin:12px 0}</style></head><body><main><small>SSU USC · REVIEW BUILD</small><h1>Staging setup required</h1><p>This Preview is protected from connecting to production student records. The updated dashboards become available after isolated staging services are configured.</p><ol><li>Create isolated Firebase and Supabase staging projects with test accounts.</li><li>Set <code>STAGING_FIREBASE_WEB_CONFIG</code>, <code>STAGING_SUPABASE_URL</code> and <code>STAGING_SUPABASE_ANON_KEY</code> for Vercel Preview builds.</li><li>Deploy the matching rules, email services and test-only email configuration to staging, then rebuild this Preview.</li></ol><p>No application scripts or database connections are included in this setup build.</p></main></body></html>`;
function stagingConfig(env){
 if(env.VERCEL_ENV==='production')return {mode:'unchanged'};
 if(env.VERCEL_ENV!=='preview')return {mode:'blocked'};
 try{
  const config=JSON.parse(env.STAGING_FIREBASE_WEB_CONFIG||'null'),url=String(env.STAGING_SUPABASE_URL||''),key=String(env.STAGING_SUPABASE_ANON_KEY||'');
  const allowed=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId','measurementId'];
  if(!config||Object.keys(config).some(k=>!allowed.includes(k))||!['apiKey','projectId','authDomain','appId'].every(k=>typeof config[k]==='string'&&config[k].length>3)||config.projectId===production.firebaseProject||config.apiKey===production.firebaseKey||config.authDomain!==`${config.projectId}.firebaseapp.com`||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)||url===production.supabaseUrl)throw Error('Incomplete isolated configuration');
  const publishable=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  let anon=false;try{anon=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon'}catch{}
  if(!publishable&&!anon)throw Error('Only public client keys are accepted');
  return {mode:'staging',config,url,key};
 }catch{return {mode:'blocked'}}
}
function buildReview(root,output,env=process.env){
 const config=stagingConfig(env);fs.mkdirSync(output,{recursive:true});
 function walk(source,relative=''){
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
   if(skipped.has(entry.name)||entry.name.startsWith('.'))continue;
   const next=path.join(relative,entry.name),sourcePath=path.join(source,entry.name);
   if(path.resolve(sourcePath)===path.resolve(output))continue;
   if(entry.isDirectory()){if(next.replaceAll(path.sep,'/')!=='supabase/functions')walk(sourcePath,next);continue;}
   if(!entry.isFile()||/\.(?:log|md|rules)$/.test(entry.name)||['package.json','package-lock.json','firebase.json','firestore.indexes.json','vercel.json'].includes(entry.name))continue;
   const target=path.join(output,next);
   if(config.mode==='blocked'){if(path.extname(entry.name)==='.html'){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,gate)}continue;}
   fs.mkdirSync(path.dirname(target),{recursive:true});let bytes=fs.readFileSync(sourcePath);
   if(config.mode==='staging'&&/\.(?:js|mjs|html|json)$/.test(entry.name)){
    let sourceText=bytes.toString().replaceAll(production.supabaseUrl,config.url);
    if(next.replaceAll(path.sep,'/')==='firebase/firebase-config.js')sourceText=sourceText.replace(/export const firebaseConfig = \{[\s\S]*?\};/,`export const firebaseConfig = ${JSON.stringify(config.config,null,2)};`);
    if(next.replaceAll(path.sep,'/')==='supabase/supabase-config.js')sourceText=sourceText.replace(/export const SUPABASE_ANON_KEY = "[^"]*";/,`export const SUPABASE_ANON_KEY = ${JSON.stringify(config.key)};`);
    bytes=Buffer.from(sourceText);
   }
   fs.writeFileSync(target,bytes);
  }
 }
 walk(root);if(config.mode==='blocked')fs.writeFileSync(path.join(output,'index.html'),gate);
 return config.mode;
}
if(require.main===module){const root=path.resolve(__dirname,'..'),output=path.join(root,'review-build');fs.rmSync(output,{recursive:true,force:true});console.log(`SSU build mode: ${buildReview(root,output)}`)}
module.exports={stagingConfig,buildReview};
