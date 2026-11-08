import {auth,db} from '../firebase/firebase-config.js';
import {doc,getDoc,setDoc,deleteDoc} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import {hasVerifiedNotificationEmail,showEmailVerificationRequired} from './verified-email.js';
const draftRef=id=>doc(db,'candidate_registration_drafts',auth.currentUser.uid,'elections',id);
const pointerKey=()=>`candidateDraftElection:${auth.currentUser.uid}`;
export const verifiedCandidateEmail=hasVerifiedNotificationEmail;
export async function restoreCandidateDraft(electionId){
 const uid=auth.currentUser?.uid;if(!uid)return null;
 let selected=electionId;try{const remembered=sessionStorage.getItem(pointerKey());if(/^[A-Za-z0-9:_-]{1,128}$/.test(remembered||''))selected=remembered}catch{}
 const record=await getDoc(draftRef(selected));if(auth.currentUser?.uid!==uid)return null;const data=record.data();
 if(!record.exists()||data.electionId!==selected||data.expiresAtMs<=Date.now())return null;
 return {...data,photoFile:null,supportingFiles:[]};
}
export async function clearCandidateDraft(electionId){await deleteDoc(draftRef(electionId));try{if(sessionStorage.getItem(pointerKey())===electionId)sessionStorage.removeItem(pointerKey())}catch{}}
export function showCandidateEmailRequired({saveProgress}){
 return showEmailVerificationRequired({saveProgress:()=>saveProgress(async(electionId,data)=>{await setDoc(draftRef(electionId),{...data,expiresAtMs:Date.now()+86400000});try{sessionStorage.setItem(pointerKey(),electionId)}catch{}})});
}
