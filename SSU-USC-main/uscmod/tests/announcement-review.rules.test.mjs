import test from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc,getDoc,setDoc,updateDoc,writeBatch,collection,getDocs,Timestamp } from 'firebase/firestore';
test('draft privacy and direct publication bypasses are denied, exact archive restore works',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-ssu-announcement-review',firestore:{rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
 try{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users','publisher'),{role:'officer',accountStatus:'approved',isActive:true,officePosition:'Public Information Officer',officerPermissions:['dashboard.view','bulletin.manage'],officerPermissionSource:'custom'});await setDoc(doc(db,'announcement_drafts','private'),{authorUid:'publisher',status:'draft',content:{title:'Private'}});await setDoc(doc(db,'archived_announcements','old'),{post:{title:'Previously published',content:'Original body'}});});
 const db=env.authenticatedContext('publisher',{role:'officer'}).firestore(),publicDb=env.unauthenticatedContext().firestore();
 await assertFails(getDoc(doc(publicDb,'announcement_drafts','private')));await assertFails(getDoc(doc(db,'announcement_drafts','private')));await assertFails(getDocs(collection(db,'announcement_drafts')));await assertFails(setDoc(doc(db,'announcement_drafts','forged'),{status:'ready'}));
 await assertFails(setDoc(doc(db,'announcements','new'),{title:'Skip review'}));await assertFails(setDoc(doc(db,'archived_announcements','forged'),{post:{title:'Skip review via archive'}}));
 let b=writeBatch(db);b.set(doc(db,'announcements','old'),{title:'Changed text',content:'Original body'});b.delete(doc(db,'archived_announcements','old'));await assertFails(b.commit());
 b=writeBatch(db);b.set(doc(db,'announcements','old'),{title:'Previously published',content:'Original body'});b.delete(doc(db,'archived_announcements','old'));await assertSucceeds(b.commit());
 await assertSucceeds(getDoc(doc(publicDb,'announcements','old')));await assertFails(updateDoc(doc(db,'announcements','old'),{content:'Edit without review'}));
 }finally{await env.cleanup();}
});
