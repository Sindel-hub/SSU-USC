import {auth,db} from '../firebase/firebase-config.js';
import {doc,getDoc,setDoc,deleteDoc} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import {callStudentEmailService} from './supabase-email-service.js';
const draftRef=id=>doc(db,'candidate_registration_drafts',auth.currentUser.uid,'elections',id);
const pointerKey=()=>`candidateDraftElection:${auth.currentUser.uid}`;
export async function verifiedCandidateEmail(){return (await callStudentEmailService('candidate_email_status')).verified===true;}
export async function restoreCandidateDraft(electionId){
 const uid=auth.currentUser?.uid;if(!uid)return null;
 let selected=electionId;try{const remembered=sessionStorage.getItem(pointerKey());if(/^[A-Za-z0-9:_-]{1,128}$/.test(remembered||''))selected=remembered}catch{}
 const record=await getDoc(draftRef(selected));if(auth.currentUser?.uid!==uid)return null;const data=record.data();
 if(!record.exists()||data.electionId!==selected||data.expiresAtMs<=Date.now())return null;
 return {...data,photoFile:null,supportingFiles:[]};
}
export async function clearCandidateDraft(electionId){await deleteDoc(draftRef(electionId));try{if(sessionStorage.getItem(pointerKey())===electionId)sessionStorage.removeItem(pointerKey())}catch{}}
export function showCandidateEmailRequired({saveProgress}){
 return new Promise(resolve=>{
  const modal=document.createElement('dialog');modal.className='candidate-email-required';modal.setAttribute('aria-labelledby','candidateEmailRequiredTitle');
  modal.innerHTML=`<form method="dialog"><header><span class="candidate-email-icon" aria-hidden="true">✉</span><div><h2 id="candidateEmailRequiredTitle">Email Verification Required</h2><p>Candidate Registration</p></div></header><p>Before submitting your candidacy application, connect and verify one Gmail or institutional email address to receive important application updates.</p><p class="candidate-email-hint">Your form stays open while you verify your email in Student Profile.</p><p data-email-error role="status"></p><button type="button" data-connect>Connect Gmail / Institutional Email<span>Open Student Profile email settings</span></button><button value="cancel">Cancel</button></form>`;
  document.body.append(modal);modal.showModal();modal.addEventListener('close',()=>{modal.remove();resolve(false)},{once:true});
  modal.querySelector('[data-connect]').onclick=async()=>{
   const button=modal.querySelector('[data-connect]');button.disabled=true;
   try{
    await saveProgress(async(electionId,data)=>{await setDoc(draftRef(electionId),{...data,expiresAtMs:Date.now()+86400000});try{sessionStorage.setItem(pointerKey(),electionId)}catch{}});
    modal.close();window.dispatchEvent(new CustomEvent('usc:open-profile-email'));
   }catch{modal.querySelector('[data-email-error]').textContent='Your draft could not be saved. Please try again; your form is still here.';button.disabled=false;}
  };
 });
}
