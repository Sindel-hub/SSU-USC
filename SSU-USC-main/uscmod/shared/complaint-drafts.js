import {auth,db} from '../firebase/firebase-config.js';
import {doc,collection,getDoc,getDocs,writeBatch,runTransaction,query,orderBy} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
const root=uid=>doc(db,'complaint_drafts',uid),entry=(uid,id)=>doc(db,'complaint_drafts',uid,'entries',id),chunks=(uid,id)=>collection(db,'complaint_drafts',uid,'entries',id,'attachmentChunks');
function sameAccount(uid){if(!uid||auth.currentUser?.uid!==uid)throw new Error('Your account changed. Reopen the complaint form.');}
export async function saveComplaintDraft({uid,requestId,fields,attachment,chunks:preparedChunks=null}){
 sameAccount(uid);const existing=preparedChunks?await getDocs(chunks(uid,requestId)):null;sameAccount(uid);
 const batch=writeBatch(db),newIds=new Set((preparedChunks||[]).map(c=>String(c.index).padStart(4,'0')));
 existing?.docs.forEach(c=>{if(!newIds.has(c.id))batch.delete(c.ref)});
 preparedChunks?.forEach(chunk=>batch.set(doc(chunks(uid,requestId),String(chunk.index).padStart(4,'0')),{studentUid:uid,index:chunk.index,payload:chunk.payload}));
 batch.set(entry(uid,requestId),{...fields,requestId,...attachment,expiresAtMs:Date.now()+86400000});
 batch.set(root(uid),{requestId,savedAtMs:Date.now()});await batch.commit();
}
export async function restoreComplaintDraft(uid){
 sameAccount(uid);const pointer=await getDoc(root(uid));const id=pointer.data()?.requestId;if(!/^[a-f0-9-]{24,64}$/i.test(id||''))return null;
 const draft=await getDoc(entry(uid,id));sameAccount(uid);const data=draft.data();if(!data||data.requestId!==id||data.expiresAtMs<=Date.now())return null;return data;
}
export async function draftAttachmentPreview(uid,draft){
 sameAccount(uid);if(!draft.attachmentType?.startsWith('image/'))return null;
 const snapshot=await getDocs(query(chunks(uid,draft.requestId),orderBy('index')));sameAccount(uid);
 const parts=snapshot.docs.map(c=>Uint8Array.from(atob(c.data().payload),ch=>ch.charCodeAt(0)));
 return URL.createObjectURL(new Blob(parts,{type:draft.attachmentType}));
}
export async function clearComplaintDraft(uid,requestId){
 sameAccount(uid);const snapshot=await getDocs(chunks(uid,requestId));sameAccount(uid);
 const batch=writeBatch(db);snapshot.docs.forEach(c=>batch.delete(c.ref));batch.delete(entry(uid,requestId));await batch.commit();
 await runTransaction(db,async tx=>{const pointer=await tx.get(root(uid));if(pointer.data()?.requestId===requestId)tx.delete(root(uid))});
}
