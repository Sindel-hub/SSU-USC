import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../shared/supabase-email-service.js',import.meta.url),'utf8').replace(/^import .*;\n/m,'').replaceAll('export ','').replace('import.meta.url','"https://portal.invalid/shared/supabase-email-service.js"');
function client(status,data){const context=vm.createContext({auth:{currentUser:{getIdToken:async()=> 'synthetic'}},fetch:async()=>({ok:status===200,status,json:async()=>data}),URL});vm.runInContext(source,context);return context;}
for(const action of ['candidate_email_status','candidate_submit','candidate_review','candidate_notification_retry'])test(`${action}: old backend fails closed with actionable message`,async()=>{
 const c=client(400,{ok:false,message:'Unknown email-service action.'});
 await assert.rejects(c.callStudentEmailService(action),e=>e.code==='candidate-service-unavailable'&&/form is still open/.test(e.message));
});
test('verification rejection remains distinguishable from an outdated backend',async()=>{
 const c=client(400,{ok:false,code:'email-verification-required',message:'Verify your email.'});
 await assert.rejects(c.callStudentEmailService('candidate_submit'),e=>e.code==='email-verification-required');
});
test('other email actions retain their existing error',async()=>{
 const c=client(400,{ok:false,message:'Unknown email-service action.'});
 await assert.rejects(c.callStudentEmailService('save'),e=>e.message==='Unknown email-service action.'&&!e.code);
});
