import {auth} from '../firebase/firebase-config.js';
import {surveyCall} from '../shared/needs-assessment-client.js';
import {renderRespondent} from '../shared/survey-creator.mjs';
const surveyId=new URLSearchParams(location.search).get('id'),message=document.getElementById('surveyMessage'),mount=document.getElementById('surveyContent');
let generation=0;
function card(title,body,login=false){
  const section=document.createElement('section');section.className='studio-card studio-title';
  const h=document.createElement('h1');h.textContent=title;
  const p=document.createElement('p');p.textContent=body;section.append(h,p);
  if(login){const link=document.createElement('a');link.className='studio-button';link.textContent='Sign in to your student account';link.href='../index/index.html?survey='+encodeURIComponent(surveyId);section.append(link)}
  mount.replaceChildren(section);message.textContent='';
}
const completed=()=>card('You have already submitted a response','Your response has already been recorded. Only one response per student is allowed. Thank you for participating.');
async function load(user){
  const request=++generation;mount.replaceChildren();message.textContent='Loading survey…';
  if(!/^[a-zA-Z0-9]{20}$/.test(surveyId||'')){card('Invalid survey link','Please obtain the correct link from USC.');return}
  if(!user){card('Sign in to participate','Only one response is allowed per student. Your identity will not be shown to USC officers.',true);return}
  try{
    const survey=await surveyCall('Public',{surveyId});if(request!==generation)return;
    if(survey.alreadySubmitted){completed();return}
    if(survey.lifecycle!=='open'){card('Survey unavailable',survey.lifecycle==='scheduled'?'This survey has not opened yet.':'This survey is closed.');return}
    message.textContent='Your student account is used to prevent duplicate submissions. Your identity is not shown to officers. Please avoid including your name, student ID or other identifying details in your answers.';
    renderRespondent(mount,survey,{submit:async payload=>{
      if(request!==generation||auth.currentUser?.uid!==user.uid)throw Error('Your account has changed. Reopen the questionnaire.');
      const result=await surveyCall('Submit',{surveyId,...payload});
      if(request!==generation)throw Error('Your account has changed.');
      if(result.alreadySubmitted){completed();return {alreadySubmitted:true}}
      return result;
    }});
  }catch(err){if(request!==generation)return;if(err.code==='unauthenticated')card('Sign in to participate','Please sign in again to continue.',true);else card('Unable to open questionnaire',err.message)}
}
const {onAuthStateChanged}=await import('https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js');
onAuthStateChanged(auth,user=>void load(user),()=>card('Unable to verify your account','Please sign in again.',true));
