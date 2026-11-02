import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../email/js/recover-password.js',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../email/js/email-api.js',import.meta.url),'utf8').replaceAll('export ','');
function page({gmail=' Student.Recovery+portal@gmail.com ',response={ok:true,message:'Generic response'},statusCode=200,networkError=false,deferred=false}={}){
 const handlers={},requests=[],title={},text={},icon={};let resets=0,release;
 const gate=deferred?new Promise(resolve=>release=resolve):Promise.resolve();
 const nodes={recoveryGmail:{value:gmail},recoveryButton:{},recoveryStatusText:text,recoveryStatus:{classList:{remove(){},add(){}},querySelector:selector=>selector==='strong'?title:icon},recoveryForm:{addEventListener:(_,fn)=>handlers.submit=fn,reset:()=>resets++}};
 const ctx=vm.createContext({document:{getElementById:id=>nodes[id]},fetch:async(url,options)=>{
 requests.push({url,options,body:JSON.parse(options.body)});await gate;
 if(networkError)throw Error('offline');return {ok:statusCode>=200&&statusCode<300,status:statusCode,json:async()=>response};
 }});
 vm.runInContext(api,ctx);vm.runInContext(source.replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,''),ctx);
 return {submit:()=>handlers.submit({preventDefault(){}}),requests,nodes,title,text,resets:()=>resets,release:()=>release()};
}
test('verified personal Gmail recovery calls the existing public mapping service without Firebase sign-in',async()=>{
 const h=page();await h.submit();assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].body.action,'recover');assert.equal(h.requests[0].body.gmail,'student.recovery+portal@gmail.com');
 assert.equal(h.requests[0].options.credentials,'omit');assert.equal(h.requests[0].options.headers['x-firebase-token'],undefined);
 assert.equal(h.requests[0].options.headers.apikey,undefined);assert.equal(h.resets(),1);
 assert.doesNotMatch(source,/sendPasswordResetEmail|firebase-auth|firebase-config/);
});
test('successful requests use a generic message without claiming delivery or account existence',async()=>{
 const h=page();await h.submit();assert.match(h.text.textContent,/If this Gmail is verified/);
 assert.match(h.text.textContent,/does not confirm whether an account exists/);assert.doesNotMatch(h.text.textContent,/has been sent/);
});
for(const gmail of ['', 'student@ssu.edu.ph','not-an-email'])test(`invalid recovery address is rejected locally: ${gmail||'empty'}`,async()=>{
 const h=page({gmail});await h.submit();assert.equal(h.requests.length,0);assert.match(h.title.textContent,/Check your Gmail/);
});
for(const opts of [{networkError:true},{statusCode:503,response:{ok:false,message:'internal diagnostic'}},{statusCode:429,response:{ok:false}}])test(`failed recovery is retryable without exposing backend details: ${JSON.stringify(opts)}`,async()=>{
 const h=page(opts);await h.submit();assert.equal(h.title.textContent,'Recovery request failed');assert.equal(h.resets(),0);
 assert.equal(h.nodes.recoveryButton.disabled,false);assert.doesNotMatch(h.text.textContent,/internal diagnostic/);
 await h.submit();assert.equal(h.requests.length,2);
});
test('double submission sends only one recovery request while pending',async()=>{
 const h=page({deferred:true});const pending=h.submit();await h.submit();assert.equal(h.requests.length,1);
 assert.equal(h.nodes.recoveryButton.disabled,true);h.release();await pending;assert.equal(h.nodes.recoveryButton.disabled,false);
});
