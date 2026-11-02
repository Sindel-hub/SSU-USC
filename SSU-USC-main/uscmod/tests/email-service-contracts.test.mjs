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
 const actions=new Set(['admin_reset_password','recover','verify']);
 for(const file of frontendFiles){
  for(const match of read(file).matchAll(/callStudentEmailService\(["']([^"']+)["']/g))actions.add(match[1]);
 }
 assert.ok(actions.size>=12);
 for(const action of actions)assert.ok(supported.has(action),`Unsupported frontend action: ${action}`);
});
test('manual password controls and endpoints are removed while reset/recovery remain',()=>{
 assert.ok(!supported.has('admin_set_password'));
 const html=read('usc-admin/admin-dashboard/users.html');
 assert.doesNotMatch(html,/adminNewPassword|adminConfirmPassword/);
 assert.match(html,/resetUserPasswordButton/);
 assert.doesNotMatch(read('shared/security-client.js'),/adminSetUserPassword|admin_set_password/);
 assert.doesNotMatch(read('functions/index.js'),/exports\.adminSetUserPassword/);
 assert.match(read('shared/security-client.js'),/sendPasswordResetEmail/);
});
