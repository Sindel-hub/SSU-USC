import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {historyFixture}=require('./helpers/officer-history-fixture.cjs');
const list=(f,data={})=>f.h.officerDirectory(f.req('admin',data));
function legacy(f,uid,patch={}){f.seed({uid,studentId:'0'+uid.replace(/\D/g,''),fullName:'Synthetic '+uid,role:'officer',officePosition:'Secretary',college:'College of Engineering',accountStatus:'approved',isActive:true,studentStanding:'active',...patch});}
test('officer roster includes legacy and restricted officers, excludes students and removed accounts, and projects only safe fields',async()=>{
 const f=historyFixture();assert.deepEqual(await list(f),{items:[],next:null});
 legacy(f,'legacy1',{authEmail:'secret@example.invalid',password:'never-return',officerPermissions:['dashboard.view']});
 legacy(f,'legacy2',{accountStatus:'suspended',isActive:false,studentStanding:'graduated'});
 legacy(f,'removed3',{accountRemoved:true});legacy(f,'removing4',{accountRemovalPending:true});
 const result=await list(f);assert.deepEqual(result.items.map(p=>p.uid),['legacy1','legacy2']);
 assert.equal(result.items[0].term,null);assert.equal(result.items[0].position,'Secretary');
 assert.equal(result.items[1].studentStanding,'graduated');assert.equal(result.items[1].isActive,false);
 assert.deepEqual(Object.keys(result.items[0]).sort(),['uid','fullName','studentId','position','department','accountStatus','isActive','studentStanding','term'].sort());
 assert.doesNotMatch(JSON.stringify(result),/secret@example|never-return|officerPermissions/);
});
test('roster follows promotions and term completion without treating historical officers as currently registered',async()=>{
 const f=historyFixture();await f.assign();
 let officer=(await list(f)).items[0];assert.equal(officer.uid,'first');assert.equal(officer.term.status,'active');assert.equal(officer.term.administration,'2026–2027');
 assert.equal(officer.department,'University-wide');assert.equal(officer.term.authorization,undefined);
 f.advance(86400001);assert.equal((await list(f)).items[0].term.status,'expired');
 await f.h.officerAssignmentManage(f.req('admin',{action:'complete',assignmentId:'assignment-first',reason:'Turnover'}));
 assert.deepEqual((await list(f)).items,[]);assert.equal(f.records.get('officer_assignments/assignment-first').status,'completed');
});
test('roster never borrows a term belonging to another identity',async()=>{
 const f=historyFixture();await f.assign();legacy(f,'legacy1',{officerAssignmentId:'assignment-first'});
 assert.equal((await list(f)).items.find(p=>p.uid==='legacy1').term,null);
});
test('roster paginates beyond fifty records without skipping eligible accounts or repeating identities',async()=>{
 const f=historyFixture();
 for(let n=0;n<56;n++)legacy(f,'legacy'+String(n).padStart(3,'0'),{accountRemoved:n<2});
 const first=await list(f);assert.equal(first.items.length,48);assert.equal(first.next,'legacy049');
 const second=await list(f,{after:first.next});assert.equal(second.items.length,6);assert.equal(second.next,null);
 assert.equal(new Set([...first.items,...second.items].map(p=>p.uid)).size,54);
 await assert.rejects(list(f,{after:'../invalid'}),{code:'invalid-argument'});
});
test('only an active trusted administrator can read registered officers',async()=>{
 const f=historyFixture();await f.assign();
 for(const uid of ['first','second'])await assert.rejects(f.h.officerDirectory(f.req(uid,{})),{code:'permission-denied'});
 await assert.rejects(f.h.officerDirectory({data:{}}),{code:'unauthenticated'});
 await assert.rejects(f.h.officerDirectory(f.req('second',{},'admin')),{code:'permission-denied'});
 f.records.get('users/admin').isActive=false;await assert.rejects(list(f),{code:'permission-denied'});
});
