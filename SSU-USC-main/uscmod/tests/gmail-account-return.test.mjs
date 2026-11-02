import test from 'node:test';
import assert from 'node:assert/strict';
import {returnToLinkedGmailAccount,rememberGmailReturn,checkGmailReturnAccount} from '../shared/verified-gmail-return.js';
function fixture({role='student',signedIn=true,linked=true}={}){
 const records=new Map([['studentProfile','old-account'],['activeSession','true']]);
 const storage={getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
 const auth={currentUser:signedIn?{uid:'signed-in-uid'}:null,authStateReady:async()=>{}};
 let signouts=0,loads=0;
 const options={auth,storage,email:'actual@gmail.com',loadSettings:async()=>{loads++;return {settings:{active:true,verifiedEmail:linked?'actual@gmail.com':'other@gmail.com',accountRole:role}};},signOut:async()=>{signouts++;auth.currentUser=null;}};
 return {options,records,auth,signouts:()=>signouts,loads:()=>loads};
}
for(const role of ['student','officer'])test(`matching verified Gmail returns to the ${role} dashboard`,async()=>{
 const h=fixture({role});const path=await returnToLinkedGmailAccount(h.options);
 assert.equal(path,role==='officer'?'../usc-admin/overview/overview.html':'../dashboard/dashboard.html');
 assert.equal(h.signouts(),0);assert.equal(h.records.get('uscVerifiedGmailReturnUid'),'signed-in-uid');
});
test('different signed-in account is signed out and must authenticate the linked account',async()=>{
 const h=fixture({linked:false});assert.equal(await returnToLinkedGmailAccount(h.options),'../index/index.html');
 assert.equal(h.signouts(),1);assert.equal(h.records.has('studentProfile'),false);assert.equal(h.records.has('activeSession'),false);
 assert.equal(h.records.get('uscVerifiedGmailReturnEmail'),'actual@gmail.com');assert.equal(h.records.has('uscVerifiedGmailReturnUid'),false);
});
test('signed-out visitor must use a password, not the verification token',async()=>{
 const h=fixture({signedIn:false});assert.equal(await returnToLinkedGmailAccount(h.options),'../index/index.html');assert.equal(h.loads(),0);
});
test('unavailable account check fails closed without opening another dashboard',async()=>{
 const h=fixture();h.options.loadSettings=async()=>{throw Error('unavailable');};
 await assert.rejects(returnToLinkedGmailAccount(h.options),/unavailable/);assert.equal(h.records.has('uscVerifiedGmailReturnUid'),false);
});
test('account switching during the settings request fails closed',async()=>{
 const h=fixture();h.options.loadSettings=async()=>{h.auth.currentUser={uid:'other'};return {settings:{active:true,verifiedEmail:'actual@gmail.com',accountRole:'student'}};};
 await assert.rejects(returnToLinkedGmailAccount(h.options),/account changed/);assert.equal(h.records.has('uscVerifiedGmailReturnUid'),false);
});
test('inactive, unverified and unsupported-role settings cannot authorize a return',async()=>{
 for(const settings of [{active:false,verifiedEmail:'actual@gmail.com',accountRole:'student'},{active:true,verifiedEmail:'',accountRole:'student'},{active:true,verifiedEmail:'actual@gmail.com',accountRole:'admin'}]){
 const h=fixture();assert.equal(await checkGmailReturnAccount(h.auth,async()=>({settings}),'actual@gmail.com'),null);
 }
});
test('Gmail canonical aliases match but invalid identifiers are rejected',async()=>{
 const h=fixture();rememberGmailReturn('A.ctual+portal@gmail.com',h.options.storage);
 assert.equal(h.records.get('uscVerifiedGmailReturnEmail'),'actual@gmail.com');
 assert.throws(()=>rememberGmailReturn('not-gmail@example.com',h.options.storage));
});

import fs from 'node:fs';
import vm from 'node:vm';
const verifySource=fs.readFileSync(new URL('../email/js/verify-gmail.js',import.meta.url),'utf8').replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'');
function pageFixture({linked=true,role='student',unavailable=false}={}){
 const h=fixture({linked,role}),handlers={},navigations=[];
 const nodes={verifyStatus:{classList:{remove(){},add(){}},querySelector:()=>({})},verifyStatusText:{},verifyButton:{addEventListener:(event,fn)=>handlers.verify=fn},returnButton:{addEventListener:(event,fn)=>handlers.return=fn,setAttribute(){},removeAttribute(){}}};
 if(unavailable)h.options.loadSettings=async()=>{throw Error('offline');};
 h.options.storage.setItem('uscGmailVerificationToken','a'.repeat(64));
 const ctx=vm.createContext({URL,window:{location:{href:'https://preview.example/email/verify-gmail.html',assign:path=>navigations.push(path)}},history:{replaceState(){}},sessionStorage:h.options.storage,
 document:{getElementById:id=>nodes[id]},auth:h.auth,signOut:h.options.signOut,callStudentEmailService:h.options.loadSettings,
 callPublicEmailAction:async()=>({email:'actual@gmail.com',returnUrl:'https://untrusted.example/dashboard',profileLabel:'Officer Profile'}),rememberGmailReturn,returnToLinkedGmailAccount});
 vm.runInContext(verifySource,ctx);return {h,handlers,nodes,navigations};
}
test('confirmation UI checks account at click time and ignores returned external URLs',async()=>{
 const p=pageFixture();await p.handlers.verify();await p.handlers.return({preventDefault(){}});
 assert.deepEqual(p.navigations,['../dashboard/dashboard.html']);assert.equal(p.nodes.verifyButton.hidden,true);
});
test('confirmation UI never sends a different signed-in officer to their dashboard',async()=>{
 const p=pageFixture({linked:false,role:'officer'});await p.handlers.verify();await p.handlers.return({preventDefault(){}});
 assert.deepEqual(p.navigations,['../index/index.html']);assert.equal(p.h.signouts(),1);
});
test('confirmation UI stays on verified page when account check is unavailable',async()=>{
 const p=pageFixture({unavailable:true});await p.handlers.verify();await p.handlers.return({preventDefault(){}});
 assert.deepEqual(p.navigations,[]);assert.equal(p.nodes.verifyStatusText.textContent,'offline');
});
for(const checked of [true,false])test(`dashboard guard refuses ${checked?'a different UID':'an unchecked pending Gmail return'}`,async()=>{
 const guard=fs.readFileSync(new URL('../shared/auth-guard.js',import.meta.url),'utf8');
 const code=guard.slice(guard.indexOf('async function verifyProtectedPage()'),guard.indexOf('\nawait verifyProtectedPage();'));
 const rejected=[];const ctx=vm.createContext({expectedRoles:()=>['student'],sessionStorage:{getItem:key=>checked?(key==='uscVerifiedGmailReturnUid'?'linked-uid':null):(key==='uscVerifiedGmailReturnEmail'?'actual@gmail.com':null)},Date,GMAIL_RETURN_UID:'uscVerifiedGmailReturnUid',GMAIL_RETURN_EMAIL:'uscVerifiedGmailReturnEmail',
 onAuthStateChanged:(_auth,fn)=>{queueMicrotask(()=>fn({uid:'different-uid'}));return ()=>{};},auth:{},fail:async message=>{rejected.push(message);return false;}});
 vm.runInContext(code,ctx);assert.equal(await ctx.verifyProtectedPage(),false);assert.match(rejected[0],/account changed/);
});
