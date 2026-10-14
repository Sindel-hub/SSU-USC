import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { RETENTION_MS, daysRemaining, canRestore } from '../usc-admin/announcements/js/announcement-retention.mjs';

test('restore window ends exactly at expiry and rounds remaining days up', () => {
  const now = Date.now();
  assert.equal(daysRemaining(new Date(now + RETENTION_MS), now), 30);
  assert.equal(daysRemaining({toMillis:()=>now+1}, now), 1);
  assert.equal(canRestore(new Date(now), now), false);
  assert.equal(canRestore(new Date(now+1), now), true);
  assert.equal(daysRemaining(null, now), 0);
});

const source = fs.readFileSync(new URL('../usc-admin/announcements/js/announcements.js',import.meta.url),'utf8');
const moveSource = source.slice(source.indexOf('async function movePost'),source.indexOf('\nfunction safeText'));
function harness(entries, view) {
  const records = new Map(entries);
  const context = vm.createContext({
    bulletinView:view, db:{}, RETENTION_MS, canRestore,
    doc:(_db,name,id)=>`${name}/${id}`,
    serverTimestamp:()=>new Date(), Timestamp:{fromMillis:ms=>new Date(ms)},
    runTransaction:async (_db,callback)=>{
      const writes=[];
      await callback({
        get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),
        set:(ref,data)=>writes.push(()=>records.set(ref,data)),
        delete:ref=>writes.push(()=>records.delete(ref))
      });
      writes.forEach(write=>write());
    }
  });
  vm.runInContext(moveSource,context);
  return {records, move:context.movePost, context};
}
test('archive, trash and restore preserve post data and return to original library', async()=>{
  const post={title:'Campus notice',content:'Original content',imageUrl:'photo.jpg'};
  const h=harness([['announcements/a',post]],'published');
  await h.move('a','archive');
  assert.equal(h.records.has('announcements/a'),false);
  assert.deepEqual(h.records.get('archived_announcements/a').post,post);
  h.context.bulletinView='archive';
  await h.move('a','delete');
  const deleted=h.records.get('deleted_announcements/a');
  assert.equal(deleted.sourceCollection,'archived_announcements');
  assert.equal(daysRemaining(deleted.expiresAt),30);
  h.context.bulletinView='deleted'; await h.move('a','restore');
  assert.equal(h.records.has('deleted_announcements/a'),false);
  assert.deepEqual(h.records.get('archived_announcements/a').post,post);
  h.context.bulletinView='archive'; await h.move('a','restore');
  assert.deepEqual(h.records.get('announcements/a'),post);
});
test('expired restore and destination conflicts leave all documents intact',async()=>{
  const h=harness([['deleted_announcements/a',{post:{title:'Old'},sourceCollection:'announcements',expiresAt:new Date(Date.now()-1)}]],'deleted');
  await assert.rejects(h.move('a','restore'),/restoration period/);
  assert.equal(h.records.size,1);
  const conflict=harness([['announcements/a',{title:'Live'}],['archived_announcements/a',{post:{title:'Saved'}}]],'published');
  await assert.rejects(conflict.move('a','archive'),/saved copy/);
  assert.equal(conflict.records.size,2);
});

test('permanent deletion removes only the selected trash post and cannot remove live posts', async () => {
  const h=harness([['deleted_announcements/a',{post:{title:'Remove'}}],['deleted_announcements/b',{post:{title:'Keep'}}]],'deleted');
  await h.move('a','permanent-delete');
  assert.equal(h.records.has('deleted_announcements/a'),false);
  assert.equal(h.records.has('deleted_announcements/b'),true);
  const live=harness([['announcements/a',{title:'Live'}]],'published');
  await assert.rejects(live.move('a','permanent-delete'),/Only posts in Recently Deleted/);
  assert.equal(live.records.has('announcements/a'),true);
});
