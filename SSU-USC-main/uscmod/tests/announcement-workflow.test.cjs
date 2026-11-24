const {test}=require('node:test');
const assert=require('node:assert/strict');
const {historyFixture}=require('./helpers/officer-history-fixture.cjs');
const {createAnnouncementWorkflow}=require('../server/announcement-workflow.cjs');
async function setup(){const f=historyFixture();await f.assign('first','Public Information Officer');await f.assign('second','President');await f.assign('other','Executive Secretary');f.w=createAnnouncementWorkflow({db:f.db,...f.authorization,history:f.history,Timestamp:{fromMillis:n=>n},clock:()=>f.now});f.call=(uid,action,version=1,extra={})=>f.w.announcementWorkflow(f.req(uid,{action,draftId:'draft-1',expectedVersion:version,...extra}));f.input={title:'Council announcement',content:'First paragraph.\n\nSecond paragraph.',category:'Official Notice',audience:'All Students',imageUrl:'',facebookRequested:false};return f;}
test('draft stays private, another reviewer checks exact version, publication is idempotent',async()=>{const f=await setup();await f.call('first','save',0,{input:f.input});assert.equal(f.records.has('announcements/draft-1'),false);await assert.rejects(f.w.announcementPublishedImage('draft-1'),/not found/);await assert.rejects(f.call('first','publish'),/reviewed/);await f.call('first','submit');f.records.get('users/first').officerPermissions.push('bulletin.review');f.records.get('officer_assignments/assignment-first').permissions.push('bulletin.review');await assert.rejects(f.call('first','ready'),/reviewer/);await f.call('second','ready');await f.call('first','publish');assert.equal(f.records.get('announcements/draft-1').content,f.input.content);assert.equal(f.records.get('announcements/draft-1').reviewedByUid,'second');const n=f.reports().length;await f.call('first','publish');assert.equal(f.reports().length,n);assert.equal(f.records.get('announcement_drafts/draft-1').status,'published');});
test('revision requires a note, author edits invalidate review, stale writes fail',async()=>{const f=await setup();await f.call('first','save',0,{input:f.input});await f.call('first','submit');await assert.rejects(f.call('second','revise',1,{note:''}),/note/);await f.call('second','revise',1,{note:'Correct the date.'});await f.call('first','save',1,{input:{...f.input,content:'Corrected date'}});await assert.rejects(f.call('first','submit',1),/changed/);await f.call('first','submit',2);await f.call('second','ready',2);await f.call('first','save',2,{input:{...f.input,content:'Another change'}});await assert.rejects(f.call('first','publish',3),/reviewed/);assert.equal(f.records.has('announcements/draft-1'),false);});
test('Secretary can draft but cannot review or publish; unrelated author cannot edit',async()=>{const f=await setup();await f.call('other','save',0,{input:f.input});await assert.rejects(f.call('first','save',1,{input:f.input}),/author/);await f.call('other','submit');await assert.rejects(f.call('other','ready'),/reviewer/);await f.call('second','ready');await assert.rejects(f.call('other','publish'),/Publishing/);await f.call('first','publish');});
test('turnover and unapproved roles deny actions; old direct publish endpoint is blocked',async()=>{const f=await setup();await assert.rejects(f.h.officerModuleAction(f.req('first',{module:'announcements',action:'publish',input:f.input,operationId:'bypass'})),/content review/);await f.call('first','save',0,{input:f.input});f.records.get('officer_assignments/assignment-first').status='completed';await assert.rejects(f.call('first','submit'),/not active|not active yet|ended/);});
test('draft-only officers list their own drafts; readers cannot retrieve drafts',async()=>{const f=await setup();await f.call('first','save',0,{input:f.input});assert.equal((await f.w.announcementDraftList(f.req('other',{}))).items.length,0);assert.equal((await f.w.announcementDraftList(f.req('second',{}))).items.length,1);f.records.get('users/other').officerPermissions=['dashboard.view'];await assert.rejects(f.w.announcementDraftList(f.req('other',{})),/not assigned/);});
test('oversize and external draft images are rejected; private image publishes unchanged',async()=>{const f=await setup();await assert.rejects(f.call('first','save',0,{input:{...f.input,imageUrl:'https://example.invalid/image.png'}}),/image/);await assert.rejects(f.call('first','save',0,{input:{...f.input,content:'x'.repeat(20001)}}),/content/);const image='data:image/webp;base64,AAAA';await f.call('first','save',0,{input:{...f.input,imageUrl:image}});await f.call('first','submit');await f.call('second','ready');await f.call('first','publish');assert.equal(await f.w.announcementPublishedImage('draft-1'),image);assert.match(f.records.get('announcements/draft-1').imageUrl,/^https:\/\/example.invalid\/api\/announcement-image/);f.records.delete('announcements/draft-1');await assert.rejects(f.w.announcementPublishedImage('draft-1'),/not found/);});

test('President can explicitly approve and publish their own submitted version', async () => {
  const f = await setup();
  await f.call('second', 'save', 0, { input: f.input });
  await f.call('second', 'submit');
  assert.equal((await f.w.announcementDraftList(f.req('second', {}))).capabilities.approveOwn, true);
  await assert.rejects(f.call('second', 'publish'), /reviewed/);
  await assert.rejects(f.call('second', 'ready', 0), /changed/);
  await f.call('second', 'ready');
  assert.equal(f.records.get('announcement_drafts/draft-1').approvalMode, 'president-self');
  await f.call('second', 'publish');
  assert.equal(f.records.get('announcements/draft-1').reviewedByUid, 'second');
});

test('President self-approval respects the active term permissions', async () => {
  const f = await setup();
  await f.call('second', 'save', 0, { input: f.input });
  await f.call('second', 'submit');
  const term = f.records.get('officer_assignments/assignment-second');
  term.permissions = term.permissions.filter(permission => permission !== 'bulletin.review');
  assert.equal((await f.w.announcementDraftList(f.req('second', {}))).capabilities.approveOwn, false);
  await assert.rejects(f.call('second', 'ready'), /reviewer/);
});
