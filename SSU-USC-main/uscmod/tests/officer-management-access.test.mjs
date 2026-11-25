import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
const start=source.indexOf('exports.adminUpdateUser =');
const end=source.indexOf('\nexports.',start+1);
function handler(profile){
  let authReads=0;
  const context=vm.createContext({exports:{},onCall:(_,fn)=>fn,callableOptions:()=>({}),requireActiveRole:async()=>{},requireRecentAuth(){},
    cleanText:(v,max)=>String(v??'').trim().slice(0,max),
    db:{doc:()=>({get:async()=>({exists:true,data:()=>({accountStatus:"approved",...profile})})})},
    HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},
    normalizeOfficerPermissionList:v=>v,permissionsForOfficerPosition:()=>['dashboard.view'],
    adminAuth:{getUser:async()=>{authReads++;throw {code:'auth/user-not-found'};}},console});
  vm.runInContext(source.slice(start,end),context);
  return {call:data=>context.exports.adminUpdateUser({auth:{uid:'admin',token:{}},data:{uid:'target',...data}}),reads:()=>authReads};
}
test('callable directory edits cannot promote students or alter legacy officer privileges',async()=>{
  for(const [profile,patch] of [
    [{role:'student',accountStatus:'approved'},{role:'officer',officePosition:'Treasurer'}],
    [{role:'officer',officePosition:'Treasurer',officerPermissions:['dashboard.view']},{role:'student'}],
    [{role:'officer',officePosition:'Treasurer',officerPermissions:['dashboard.view']},{officePosition:'President'}],
    [{role:'officer',officePosition:'Treasurer',officerPermissions:['dashboard.view']},{officerPermissions:['dashboard.view','bulletin.manage']}],
    [{role:'officer',officePosition:'Treasurer',officerPermissions:['dashboard.view'],officerPermissionSource:'custom'},{officerPermissionSource:'position-default'}]
  ]){
    const h=handler(profile);
    await assert.rejects(h.call(patch),error=>error.code==='failed-precondition'&&/Officer Management/.test(error.message));
    assert.equal(h.reads(),0);
  }
});
test('ordinary directory status edits still reach the existing authentication checks',async()=>{
  const h=handler({role:'student',accountStatus:'approved'});
  await assert.rejects(h.call({accountStatus:'suspended'}),/no matching Firebase Authentication account/);
  assert.equal(h.reads(),1);
});
