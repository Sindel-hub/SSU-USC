import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/_shared/usc-email-common.ts',import.meta.url),'utf8').replace(/^import .*;\n/,''),{mode:'transform'}).replace(/export /g,'');
function adapter(respond=()=>({})){
  const requests=[];
  const fetch=async(url,init={})=>{requests.push({url,init,body:init.body?JSON.parse(init.body):null});const payload=respond(url,init);return new Response(JSON.stringify(payload.data||payload),{status:payload.status||200});};
  const names={FIREBASE_PROJECT_ID:'demo-ssu-registration',FIREBASE_WEB_API_KEY:'test-key',SUPABASE_URL:'https://test.invalid',PORTAL_URL:'https://portal.invalid',RESEND_API_KEY:'test-key',EMAIL_FROM:'test@example.invalid'};
  const Deno={env:{get:name=>names[name]}};
  const api=new Function('Deno','fetch','createClient',`${source};cachedGoogleToken='test-only';cachedGoogleTokenUntil=Date.now()+3600000;return {firestoreVersionedGet,firestoreIdentityCommit,verifyFirebaseIdToken,resetFirebaseAuthPassword};`)(Deno,fetch,()=>({}));
  return {...api,requests};
}
test('trusted Firestore REST adapter uses masked atomic writes with version and create-only preconditions',async()=>{
  const api=adapter();
  await api.firestoreIdentityCommit([
    {path:'users/student',version:'2026-01-01T00:00:00Z',data:{email:'ana@ssu.edu.ph',institutionalEmailVerified:true,updatedAtMs:123}},
    {path:'login_aliases/email_hash',version:null,data:{authEmail:'123456@student.ssu-usc.local',kind:'institutionalEmail',uid:'student',verified:true}},
    {path:'institutional_email_requests/student',version:'2026-01-01T00:00:00Z',remove:true}
  ]);
  const writes=api.requests[0].body.writes;
  assert.match(api.requests[0].url,/documents:commit$/);
  assert.deepEqual(writes[0].updateMask.fieldPaths,['email','institutionalEmailVerified','updatedAtMs']);
  assert.deepEqual(writes[0].currentDocument,{updateTime:'2026-01-01T00:00:00Z'});
  assert.deepEqual(writes[1].currentDocument,{exists:false});
  assert.equal(writes[0].update.fields.updatedAtMs.integerValue,'123');
  assert.equal(writes[1].update.fields.verified.booleanValue,true);
  assert.match(writes[2].delete,/institutional_email_requests\/student$/);
  assert.ok(!JSON.stringify(writes).includes('password'));
});
test('versioned reads retain Firestore updateTime and reject provider conflicts',async()=>{
  const api=adapter(()=>({fields:{institutionalEmail:{nullValue:null},email:{stringValue:''}},updateTime:'version'}));
  assert.deepEqual(await api.firestoreVersionedGet('users/student'),{data:{institutionalEmail:null,email:''},version:'version'});
  const denied=adapter(()=>({status:409,data:{error:{message:'precondition failed'}}}));
  await assert.rejects(denied.firestoreIdentityCommit([{path:'users/student',version:'stale',data:{email:'ana@ssu.edu.ph'}}]),/precondition failed/);
});
test('Firebase session claims are decoded only after Google validates the exact token',async()=>{
  const claims={role:'admin',auth_time:123};
  const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+'signature'.repeat(12);
  const api=adapter(()=>({users:[{localId:'admin',email:'admin@ssu.edu.ph'}]}));
  assert.deepEqual(await api.verifyFirebaseIdToken(token),{uid:'admin',email:'admin@ssu.edu.ph',disabled:false,role:'admin',authTime:123});
  assert.equal(api.requests[0].body.idToken,token);
  const invalid=adapter(()=>({status:400,data:{error:{message:'INVALID_ID_TOKEN'}}}));
  await assert.rejects(invalid.verifyFirebaseIdToken(token),/no longer valid/);
});
test('trusted password reset sets the target Firebase password and invalidates older sessions without a Firestore password write',async()=>{
  const api=adapter();await api.resetFirebaseAuthPassword('student','Generated!123',1700000000000);
  assert.deepEqual(api.requests[0].body,{localId:'student',password:'Generated!123',validSince:'1700000000'});
  assert.match(api.requests[0].url,/identitytoolkit.*accounts:update$/);
});
