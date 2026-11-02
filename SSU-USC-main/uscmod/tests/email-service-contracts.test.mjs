import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const handler=read('supabase/functions/usc-email/index.ts');
const supported=new Set([...handler.matchAll(/action === ["']([^"']+)["']/g)].map(x=>x[1]));
for(const group of handler.matchAll(/\[([^\]]+)\]\.includes\(action\)/g)){
 for(const item of group[1].matchAll(/["']([^"']+)["']/g))supported.add(item[1]);
}
const frontendFiles=['shared/supabase-email-service.js','shared/email-settings.js','shared/profile-manager.js','shared/institutional-email-settings.js','shared/security-client.js','index/js/index.js','email/js/verify-institutional.js','usc-admin/admin-dashboard/js/admin-users.js'];
test('every literal frontend email-service action has an explicit integrated Edge route',()=>{
 const actions=new Set(['admin_set_password','admin_reset_password','recover','verify']);
 for(const file of frontendFiles){
  for(const match of read(file).matchAll(/callStudentEmailService\(["']([^"']+)["']/g))actions.add(match[1]);
 }
 assert.ok(actions.size>=12);
 for(const action of actions)assert.ok(supported.has(action),`Unsupported frontend action: ${action}`);
});
test('manual password and generated reset are distinct contracts; manual requests never silently generate',()=>{
 assert.match(handler,/action === "admin_set_password" && typeof body.newPassword !== "string"/);
 assert.match(handler,/action === "admin_set_password" \? body.newPassword : undefined/);
 assert.match(read('shared/security-client.js'),/data.newPassword !== undefined \? "admin_set_password" : "admin_reset_password"/);
});

test('trusted Firebase lookup exposes current privileged claims and rejects malformed claim metadata', async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const vm=await import('node:vm');
 const source=stripTypeScriptTypes(read('supabase/functions/_shared/usc-email-common.ts')).replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/\bexport\s+/g,'');
 const ctx=vm.createContext({console,fetch(){throw Error('Network forbidden');}});
 vm.runInContext(source,ctx);
 let account={localId:'synthetic-target',email:'synthetic@example.invalid',disabled:false,emailVerified:true,customAttributes:'{"role":"admin"}'};
 ctx.env=()=>({firebaseProjectId:'synthetic-project'});
 ctx.googleJson=async()=>({users:[account]});
 let result=await ctx.firebaseUserByUid('synthetic-target');
 assert.equal(result.uid,'synthetic-target');assert.equal(result.customClaims.role,'admin');
 account={...account,disabled:true,customAttributes:'{}'};
 result=await ctx.firebaseUserByUid('synthetic-target');assert.equal(result.disabled,true);
 for(const value of ['not-json','null','[]']){
  account.customAttributes=value;await assert.rejects(ctx.firebaseUserByUid('synthetic-target'));
 }
});
