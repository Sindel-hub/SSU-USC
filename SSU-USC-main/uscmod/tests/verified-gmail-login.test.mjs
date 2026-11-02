import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {resolveVerifiedGmailAccount,createGmailPasswordAuthenticator} from '../supabase/functions/usc-email/gmail-login.mjs';
import {institutionalEmailForDisplay} from '../shared/account-email.js';
import {isActiveStudentStanding,studentStandingLabel} from '../shared/student-standing.js';
const strip=s=>s.replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'');
const canonicalGmail=value=>{
 const email=String(value||'').trim().toLowerCase();
 return /^[a-z0-9.]+(?:\+[a-z0-9._-]+)?@gmail\.com$/.test(email)?email.split('@')[0].split('+')[0].replaceAll('.','')+'@gmail.com':'';
};
function fixture(){
 const profile={uid:'school-uid',role:'student',studentId:'001234',institutionalEmail:'student@ssu.edu.ph',institutionalEmailVerified:false,schoolProvisioned:true,isActive:true,accountStatus:'approved',studentStanding:'active',college:'Science',fullName:'Example Student'};
 const account={firebase_uid:'school-uid',requested_email:'personal@gmail.com',verified_email:'personal@gmail.com',verified_at:'2026-11-02',recovery:false};
 const user={uid:'school-uid',email:'001234@student.ssu-usc.local',disabled:false};
 const deps={canonicalGmail,verifiedAccount:async()=>account,profile:async()=>profile,activeProfile:p=>p?.schoolProvisioned===true&&['student','officer'].includes(p.role)&&p.isActive!==false&&p.accountStatus==='approved'&&p.studentStanding==='active',authUser:async()=>user,authByEmail:async()=>null};
 return {deps,account,profile,user};
}
test('already-verified Gmail resolves the same Firebase UID without recovery being enabled',async()=>{
 const h=fixture();const before=JSON.stringify(h);
 assert.deepEqual(await resolveVerifiedGmailAccount(h.deps,'P.er.sonal+alerts@gmail.com'),{uid:'school-uid',authEmail:h.user.email});
 assert.equal(JSON.stringify(h),before);
});
for(const [name,change] of [
 ['unverified',h=>{h.account.verified_email=null;}],
 ['missing verification timestamp',h=>{h.account.verified_at=null;}],
 ['changed Gmail',h=>{h.account.requested_email='replacement@gmail.com';}],
 ['removed Gmail',h=>{h.deps.verifiedAccount=async()=>null;}],
 ['suspended student',h=>{h.profile.accountStatus='suspended';}],
 ['inactive student',h=>{h.profile.studentStanding='withdrawn';}],
 ['disabled Firebase account',h=>{h.user.disabled=true;}],
 ['mismatched Firebase UID',h=>{h.user.uid='different-user';}],
 ['Gmail owned by another Firebase account',h=>{h.deps.authByEmail=async()=>({uid:'another-owner'});}]
])test(`${name} cannot resolve to the school account`,async()=>{const h=fixture();change(h);assert.equal(await resolveVerifiedGmailAccount(h.deps,'personal@gmail.com'),null);});
test('invalid addresses are rejected before any account lookup',async()=>{const h=fixture();h.deps.verifiedAccount=()=>{throw Error('must not query');};assert.equal(await resolveVerifiedGmailAccount(h.deps,'student@example.com'),null);});
test('provider errors fail closed',async()=>{const h=fixture();h.deps.verifiedAccount=async()=>{throw Error('unavailable');};await assert.rejects(resolveVerifiedGmailAccount(h.deps,'personal@gmail.com'),/unavailable/);});

function browser({verified=true,returnedUid='school-uid',nativeGmail=false,nativeConflict=false,activeConflict=false,trustedAdmin=false,expectedPassword='correct-password',returnGmail='',settingsGmail='personal@gmail.com'}={}){
 const h=fixture(),calls=[],requests=[],alerts=[],handlers={},storage=new Map();
 const legacy={uid:'legacy-uid',email:'personal@gmail.com',disabled:false},legacyProfile={role:'student',schoolProvisioned:true,accountStatus:activeConflict?'approved':'suspended',isActive:activeConflict,institutionalEmailVerified:true,studentStanding:'active'};
 if(nativeGmail)h.user.email='personal@gmail.com';
 h.deps.authByEmail=async email=>email==='personal@gmail.com'?(nativeConflict?legacy:nativeGmail?h.user:null):null;
 h.deps.authUser=async uid=>uid==='legacy-uid'?legacy:uid===h.user.uid?h.user:null;
 h.deps.profile=async uid=>uid==='legacy-uid'?legacyProfile:h.profile;
 h.deps.activeNativeProfile=p=>p?.accountStatus==='approved'&&p.isActive!==false&&['student','officer','admin'].includes(p.role);let resets=0,signouts=0;if(returnGmail)storage.set('uscVerifiedGmailReturnEmail',returnGmail);
 const button={},form={prepend:()=>{},querySelector:()=>button,addEventListener:(event,fn)=>{handlers[event]=fn;},reset:()=>{resets++;}};
 const elements={signinForm:form,signinIdentifier:{value:'personal@gmail.com'},signinPassword:{value:'correct-password',addEventListener:(event,fn)=>{handlers['password-'+event]=fn;}},forgotPasswordBtn:{addEventListener:(event,fn)=>{handlers.recover=fn;}}};
 const auth={currentUser:null},location={};
 const aliases=new Map([['id_001234',h.user.email],['email_'+createHash('sha256').update('student@ssu.edu.ph').digest('hex'),h.user.email]]);
 const ctx=vm.createContext({auth,db:{},crypto:webcrypto,TextEncoder,console,location,URL,
  document:{createElement:()=>({setAttribute:()=>{}}),getElementById:id=>elements[id]||null},alert:msg=>alerts.push(msg),
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  institutionalEmailForDisplay,isActiveStudentStanding,studentStandingLabel,
  doc:(_db,...parts)=>parts.join('/'),serverTimestamp:()=>123,runTransaction:async()=>{},
  getDoc:async path=>({exists:()=>path.startsWith('users/')||aliases.has(path.split('/').at(-1)),data:()=>path==='users/legacy-uid'?legacyProfile:path.startsWith('users/')?h.profile:{authEmail:aliases.get(path.split('/').at(-1))}}),
  fetch:async(url,options)=>{
   const body=JSON.parse(options.body);requests.push({url,...body,headers:options.headers});
   if(body.action==='get')return {ok:true,status:200,json:async()=>({ok:true,settings:{active:true,verifiedEmail:settingsGmail,accountRole:h.profile.role}})};
   assert.equal(body.action,'authenticate_gmail');assert.ok(url.startsWith('https://'));
   if(!verified)h.account.verified_email=null;
   const authenticate=createGmailPasswordAuthenticator({...h.deps,consumeBudget:async()=>true,finishDelay:async()=>{},passwordIdentity:async(email,password)=>{
    if(email!==h.user.email||password!==expectedPassword)throw Error('Invalid credentials');
    return {uid:h.user.uid};
   }});
   const result=await authenticate(body);
   return {ok:result.status===200,status:result.status,json:async()=>result.body};
  },
  signInWithEmailAndPassword:async(_auth,email,password)=>{
   calls.push({email,password});
   if((email!==h.user.email&&!((nativeGmail||nativeConflict)&&email==='personal@gmail.com'))||password!==expectedPassword)throw Object.assign(Error('Wrong password'),{code:'auth/invalid-credential'});
   const user={uid:nativeConflict&&email==='personal@gmail.com'?'legacy-uid':returnedUid,email:h.user.email,emailVerified:false,getIdToken:async()=> 'synthetic-token',getIdTokenResult:async()=>({claims:trustedAdmin?{role:'admin'}:{}})};auth.currentUser=user;return {user};
  },
  signOut:async()=>{auth.currentUser=null;signouts++;},
  window:{open:()=>{handlers.recoveryOpened=true;}},
 });
 vm.runInContext(strip(fs.readFileSync(new URL('../shared/supabase-email-service.js',import.meta.url),'utf8')).replaceAll('import.meta.url', JSON.stringify(new URL('../shared/supabase-email-service.js',import.meta.url).href)),ctx);
 vm.runInContext(strip(fs.readFileSync(new URL('../shared/verified-gmail-return.js',import.meta.url),'utf8')),ctx);
 vm.runInContext(strip(fs.readFileSync(new URL('../shared/pasted-password.js',import.meta.url),'utf8')),ctx);
 vm.runInContext(strip(fs.readFileSync(new URL('../index/js/index.js',import.meta.url),'utf8')),ctx);
 return {ctx,calls,requests,alerts,handlers,storage,location,auth,elements,profile:h.profile,resets:()=>resets,signouts:()=>signouts};
}
test('Gmail requires backend Firebase password proof over HTTPS before the SDK authenticates',async()=>{
 const h=browser();assert.equal((await h.ctx.signInByIdentifier('personal@gmail.com','correct-password')).user.uid,'school-uid');
 assert.deepEqual(h.calls,[{email:'001234@student.ssu-usc.local',password:'correct-password'}]);
 assert.equal(h.requests[0].headers['x-firebase-token'],undefined);assert.equal(h.requests[0].password,'correct-password');
});
test('unverified Gmail never attempts the school account password',async()=>{const h=browser({verified:false});await assert.rejects(h.ctx.signInByIdentifier('personal@gmail.com','correct-password'),/Unable to sign in/);assert.equal(h.calls.length,0);});
test('Gmail still rejects an incorrect account password',async()=>{const h=browser();await assert.rejects(h.ctx.signInByIdentifier('personal@gmail.com','wrong'),/Unable to sign in/);assert.equal(h.auth.currentUser,null);});
test('unexpected authenticated UID is signed out and rejected',async()=>{const h=browser({returnedUid:'wrong-uid'});await assert.rejects(h.ctx.signInByIdentifier('personal@gmail.com','correct-password'),e=>e.code==='auth/invalid-credential');assert.equal(h.signouts(),1);assert.equal(h.auth.currentUser,null);});
test('Gmail submit preserves student role and UID even without a verified institutional email',async()=>{
 const h=browser();await h.handlers.submit({preventDefault(){}});
 assert.equal(h.alerts.length,0);assert.equal(h.location.href,'../dashboard/dashboard.html');
 const session=JSON.parse(h.storage.get('studentProfile'));assert.equal(session.uid,'school-uid');assert.equal(session.role,'student');assert.equal(session.studentId,'001234');assert.equal(h.profile.institutionalEmailVerified,false);
});
test('Student ID and institutional email continue to sign into the same account without Supabase lookup',async()=>{
 const h=browser();for(const identifier of ['001234',' Student@SSU.edu.ph '])assert.equal((await h.ctx.signInByIdentifier(identifier,'correct-password')).user.uid,'school-uid');assert.equal(h.requests.length,0);
});
test('Forgot Password still opens the existing recovery page',()=>{const h=browser();h.handlers.recover();assert.equal(h.handlers.recoveryOpened,true);});

test('existing Firebase-native Gmail accounts keep their UID after server confirms no verified mapping',async()=>{
 const h=browser({verified:false,nativeGmail:true});
 assert.equal((await h.ctx.signInByIdentifier('personal@gmail.com','correct-password')).user.uid,'school-uid');
 assert.equal(h.requests.length,1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].email,'personal@gmail.com');
});

for(const identifier of ['001234','student@ssu.edu.ph','personal@gmail.com'])test(`formatted temporary password paste completes existing login route for ${identifier}`,async()=>{
 const h=browser({expectedPassword:'Abcdefg234!XYz'}),input=h.elements.signinPassword;
 h.elements.signinIdentifier.value=identifier;if(identifier==='student@ssu.edu.ph')h.profile.institutionalEmailVerified=true;input.selectionStart=0;input.selectionEnd=input.value.length;
 h.handlers['password-paste']({clipboardData:{getData:()=> ' Abcdefg234!XYz '}});input.value=' Abcdefg234!XYz ';
 await h.handlers.submit({preventDefault(){}});
 assert.equal(h.alerts.length,0);assert.equal(h.auth.currentUser.uid,'school-uid');
 assert.equal(h.location.href,'../dashboard/dashboard.html');
 const session=JSON.parse(h.storage.get('studentProfile'));assert.equal(session.role,'student');assert.equal(session.uid,'school-uid');
 if(identifier==='personal@gmail.com'){assert.equal(h.requests.length,2);assert.equal(h.requests.at(-1).password,'Abcdefg234!XYz');}
 else assert.equal(h.requests.length,0);
});

test('return login rejects a valid password for a different Gmail-linked account',async()=>{
 const h=browser({returnGmail:'intended@gmail.com'});h.elements.signinIdentifier.value='001234';
 await h.handlers.submit({preventDefault(){}});
 assert.equal(h.auth.currentUser,null);assert.equal(h.location.href,undefined);
 assert.match(h.alerts[0],/different account/);assert.equal(h.storage.has('activeSession'),false);
 assert.equal(h.storage.get('uscVerifiedGmailReturnEmail'),'intended@gmail.com');
});
for(const role of ['student','officer'])test(`return login preserves linked ${role} UID and role`,async()=>{
 const h=browser({returnGmail:'personal@gmail.com'});h.profile.role=role;
 await h.handlers.submit({preventDefault(){}});
 assert.equal(h.alerts.length,0);assert.equal(h.storage.get('uscVerifiedGmailReturnUid'),'school-uid');
 assert.equal(JSON.parse(h.storage.get('studentProfile')).role,role);
 assert.equal(h.location.href,role==='officer'?'../usc-admin/overview/overview.html':'../dashboard/dashboard.html');
});

test('verified Gmail never signs into suspended native mock first and reaches active mapped dashboard',async()=>{
 const h=browser({nativeConflict:true});await h.handlers.submit({preventDefault(){}});
 assert.equal(h.alerts.length,0);assert.equal(h.auth.currentUser.uid,'school-uid');assert.equal(h.location.href,'../dashboard/dashboard.html');
 assert.deepEqual(h.calls,[{email:'001234@student.ssu-usc.local',password:'correct-password'}]);
 assert.equal(JSON.parse(h.storage.get('studentProfile')).role,'student');assert.equal(h.profile.accountStatus,'approved');
});
test('active native-owner conflict is rejected without selecting another UID',async()=>{
 const h=browser({nativeConflict:true,activeConflict:true});await h.handlers.submit({preventDefault(){}});
 assert.equal(h.auth.currentUser,null);assert.equal(h.calls.length,0);assert.equal(h.location.href,undefined);assert.equal(h.alerts.length,1);
});
test('mapped suspended account stays blocked even if another native account exists',async()=>{
 const h=browser({nativeConflict:true});h.profile.accountStatus='suspended';h.profile.isActive=false;
 await h.handlers.submit({preventDefault(){}});assert.equal(h.auth.currentUser,null);assert.equal(h.calls.length,0);assert.equal(h.location.href,undefined);
});

test('native Gmail administrator requires the existing trusted admin claim',async()=>{
 const h=browser({verified:false,nativeGmail:true});h.profile.role='admin';h.profile.institutionalEmailVerified=true;
 await h.handlers.submit({preventDefault(){}});assert.equal(h.auth.currentUser,null);assert.equal(h.location.href,undefined);assert.match(h.alerts[0],/trusted System Administrator/);
});
test('eligible native Gmail administrator retains admin dashboard and existing UID',async()=>{
 const h=browser({verified:false,nativeGmail:true,trustedAdmin:true});h.profile.role='admin';h.profile.institutionalEmailVerified=true;
 await h.handlers.submit({preventDefault(){}});assert.equal(h.alerts.length,0);assert.equal(h.auth.currentUser.uid,'school-uid');assert.equal(h.location.href,'../usc-admin/admin-dashboard/admin-dashboard.html');
});
test('native Gmail SDK UID mismatch is signed out and never accepted',async()=>{
 const h=browser({verified:false,nativeGmail:true,returnedUid:'wrong-native-uid'});
 await assert.rejects(h.ctx.signInByIdentifier('personal@gmail.com','correct-password'));assert.equal(h.auth.currentUser,null);assert.equal(h.signouts(),1);
});
