import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.SSU_RULES_TEST_DEPENDENCIES || import.meta.url);
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp } = require('firebase/firestore');
let env;
before(async () => { env = await initializeTestEnvironment({ projectId:'demo-ssu-org-chart', firestore:{rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')} }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const [uid, fields] of Object.entries({officer:{role:'officer'},student:{role:'student'},inactive:{role:'officer',isActive:false},pending:{role:'officer',accountStatus:'pending'},former:{role:'officer',studentStanding:'graduated'},admin:{role:'admin'}})) {
      await setDoc(doc(ctx.firestore(),'users',uid),{isActive:true,accountStatus:'approved',studentStanding:'active',...fields});
    }
  });
});
const data = () => ({imageData:'data:image/webp;base64,UklGRg==',updatedAt:serverTimestamp()});
const db = uid => uid ? env.authenticatedContext(uid,uid==='admin'?{role:'admin'}:{}).firestore() : env.unauthenticatedContext().firestore();
for (const uid of ['officer','admin']) test(`${uid} can publish and replace the chart`, async () => {
  const ref=doc(db(uid),'organization_chart','current');await assertSucceeds(setDoc(ref,data()));await assertSucceeds(setDoc(ref,data()));
  await assertSucceeds(getDoc(doc(db(null),'organization_chart','current')));
});
for (const uid of [null,'student','inactive','pending','former']) test(`${uid || 'anonymous'} cannot publish`, async () => { await assertFails(setDoc(doc(db(uid),'organization_chart','current'),data())); });
test('enforces the document, image format, size, fields and server timestamp', async () => {
  const store=db('officer'),ref=doc(store,'organization_chart','current');
  await assertFails(setDoc(doc(store,'organization_chart','other'),data()));
  await assertFails(setDoc(ref,{...data(),imageData:'https://example.test/image.png'}));
  await assertFails(setDoc(ref,{...data(),imageData:'data:image/webp;base64,'+'A'.repeat(900000)}));
  await assertFails(setDoc(ref,{...data(),extra:'unexpected'}));
  await assertFails(setDoc(ref,{...data(),updatedAt:new Date(0)}));
  await assertFails(setDoc(ref,{imageData:data().imageData}));
});
test('readers cannot enumerate records or delete the chart', async () => {
  await assertSucceeds(setDoc(doc(db('officer'),'organization_chart','current'),data()));
  await assertFails(deleteDoc(doc(db('officer'),'organization_chart','current')));
  await assertFails(getDocs(collection(db(null),'organization_chart')));
});
