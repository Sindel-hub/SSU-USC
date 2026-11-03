import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../usc-admin/overview/js/overview.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const clean ='),source.indexOf('function setText('));
const imageHelper=source.match(/function announcementImage\(item\)[^\n]+/)[0];
const renderer=source.slice(source.indexOf('function renderBulletin()'),source.indexOf('function bindAnnouncements()'));
function fixture(item,resolve=async()=> 'blob:synthetic-image'){
 const events={},layout=[],resolved=[];const span={textContent:''},status={hidden:false,querySelector:()=>span};
 const image={hidden:true,isConnected:true,src:'',addEventListener:(event,fn)=>{events[event]=fn;}};
 const host={innerHTML:'',querySelector:selector=>selector.endsWith(' img')?image:status};
 const ctx=vm.createContext({Date,String,document:{getElementById:()=>host},state:{announcements:item?[item]:[]},syncDashboardLayout:value=>layout.push(value),resolveMediaUrl:value=>{resolved.push(value);return resolve(value);}});
 vm.runInContext(helpers+imageHelper+renderer,ctx);vm.runInContext('renderBulletin()',ctx);
 return {image,status,span,host,events,layout,resolved};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
test('officer card resolves uploaded media before assigning a browser source and displays it after load',async()=>{
 const f=fixture({imageUrl:'firestore-media://synthetic-file',title:'<Unsafe title>',content:'First\n\nSecond'});
 assert.equal(f.image.src,'');await settle();assert.equal(f.image.src,'blob:synthetic-image');assert.deepEqual(f.resolved,['firestore-media://synthetic-file']);
 f.events.load();assert.equal(f.image.hidden,false);assert.equal(f.status.hidden,true);
 assert.match(f.host.innerHTML,/&lt;Unsafe title&gt;/);assert.match(f.host.innerHTML,/First\n\nSecond/);assert.match(f.host.innerHTML,/Read more/);
});
test('direct URLs and legacy image aliases use the same resolver',async()=>{
 for(const key of ['imageUrl','imageURL','posterUrl','announcementImageUrl']){
  const f=fixture({[key]:'https://example.invalid/photo.jpg'},async value=>value);await settle();assert.equal(f.image.src,'https://example.invalid/photo.jpg');
 }
});
test('missing or failed images have explicit fallbacks while keeping the announcement',async()=>{
 const missing=fixture({title:'No photo'});assert.deepEqual(missing.resolved,[]);assert.match(missing.host.innerHTML,/No image attached/);
 const failed=fixture({imageUrl:'firestore-media://missing'},async()=>{throw Error('Missing');});await settle();assert.equal(failed.span.textContent,'Image unavailable');assert.equal(failed.image.hidden,true);assert.equal(failed.status.hidden,false);
 const loadError=fixture({imageUrl:'https://example.invalid/broken.jpg'});await settle();loadError.events.error();assert.equal(loadError.span.textContent,'Image unavailable');
});
test('stale image resolution cannot update a removed card; empty feeds remain empty',async()=>{
 let complete;const pending=fixture({imageUrl:'firestore-media://old'},()=>new Promise(resolve=>{complete=resolve;}));pending.image.isConnected=false;complete('blob:old');await settle();assert.equal(pending.image.src,'');
 const empty=fixture(null);assert.match(empty.host.innerHTML,/No announcement posted yet/);assert.deepEqual(empty.layout,[false]);
});
