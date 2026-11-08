import {callStudentEmailService} from './supabase-email-service.js';
export async function hasVerifiedNotificationEmail(){return (await callStudentEmailService('verified_email_status')).verified===true;}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function showEmailVerificationRequired({saveProgress,label='Candidate Registration',description='Before submitting your candidacy application, connect and verify one Gmail or institutional email address to receive important application updates.'}){
 return new Promise(resolve=>{
  const modal=document.createElement('dialog');modal.className='candidate-email-required';modal.setAttribute('aria-labelledby','emailVerificationRequiredTitle');
  modal.innerHTML=`<form method="dialog"><header><span class="candidate-email-icon" aria-hidden="true">✉</span><div><h2 id="emailVerificationRequiredTitle">Email Verification Required</h2><p>${escape(label)}</p></div></header><p>${escape(description)}</p><p class="candidate-email-hint">Your form stays open while you verify your email in Student Profile.</p><p data-email-error role="status"></p><button type="button" data-connect>Connect Gmail / Institutional Email<span>Open Student Profile email settings</span></button><button value="cancel">Cancel</button></form>`;
  document.body.append(modal);modal.showModal();modal.addEventListener('close',()=>{modal.remove();resolve(false)},{once:true});
  modal.querySelector('[data-connect]').onclick=async()=>{
   const button=modal.querySelector('[data-connect]');button.disabled=true;
   try{await saveProgress();modal.close();window.dispatchEvent(new CustomEvent('usc:open-profile-email'));}
   catch{modal.querySelector('[data-email-error]').textContent='Your draft could not be saved. Please try again; your form is still here.';button.disabled=false;}
  };
 });
}
