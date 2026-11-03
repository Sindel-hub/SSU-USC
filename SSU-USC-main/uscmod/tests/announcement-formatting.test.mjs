import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('usc-admin/announcements/js/announcements.js');
const preview=source.slice(source.indexOf('function syncPreviewCard()'),source.indexOf('function setImageFileLabel'));
const submit=source.slice(source.indexOf('announcementForm?.addEventListener("submit"'),source.indexOf('\nfunction setPostMenu'));
function fixture(body){
 const saved=[],alerts=[];let handler;
 const context=vm.createContext({String,Date,console,
  announcementForm:{addEventListener:(event,fn)=>{handler=fn;}},
  announcementTitleInput:{value:'Synthetic notice'},announcementCategoryInput:{value:'Official Notice'},announcementAudienceInput:{value:'All Students'},announcementContentInput:{value:body},
  publishAnnouncementBtn:{disabled:false},document:{getElementById:()=>({checked:false,disabled:false})},
  safeText:(value,fallback='')=>String(value||fallback).trim(),
  confirmPublication:async()=>true,uploadImage:async()=>({imageUrl:'',imagePath:''}),selectedImageFile:null,selectedImageObjectUrl:null,
  auth:{currentUser:{uid:'synthetic-officer',email:'synthetic@example.invalid'}},announcementsCollection:'synthetic-collection',
  addDoc:async(collection,data)=>{saved.push(structuredClone(data));return{id:'synthetic-post'};},serverTimestamp:()=>0,
  resetAnnouncementForm(){},alert:message=>alerts.push(message),
  previewCategoryBadge:{},previewDateText:{},previewTitle:{},previewAudience:{},previewContent:{},setDraftPreviewImage(){},
 });
 vm.runInContext(preview+submit,context);
 return {context,saved,alerts,publish:()=>handler({preventDefault(){}})};
}
test('actual publish handler retains all newlines and whitespace through save/reload/re-save',async()=>{
 const body='\nFirst paragraph\nSecond line\n\nSecond paragraph\n\n\nFinal paragraph\n';
 const first=fixture(body);await first.publish();assert.equal(first.saved.length,1);assert.equal(first.saved[0].content,body);
 const loaded=JSON.parse(JSON.stringify(first.saved[0]));const second=fixture(loaded.content);await second.publish();assert.equal(second.saved[0].content,body);
});
test('whitespace-only announcements stay rejected',async()=>{
 const f=fixture(' \n\n\t ');await f.publish();assert.equal(f.saved.length,0);assert.match(f.alerts[0],/complete/);
});
test('actual preview uses textContent and retains paragraphs and HTML-shaped text literally',()=>{
 const body='First\n\n<img src=x onerror=alert(1)>\n<script>bad()</script>';
 const f=fixture(body);vm.runInContext('syncPreviewCard()',f.context);assert.equal(f.context.previewContent.textContent,body);assert.equal(f.context.previewContent.innerHTML,undefined);
});
test('shared formatting stylesheet is loaded by all announcement surfaces',()=>{
 for(const file of ['usc-admin/announcements/announcements.html','dashboard/dashboard.html','dashboard/bulletin.html','home/home.html'])assert.match(read(file),/announcement-text\.css\?v=1/);
 const css=read('shared/announcement-text.css');assert.match(css,/white-space:\s*pre-wrap\s*!important/);assert.match(css,/overflow-wrap:\s*anywhere/);
});
