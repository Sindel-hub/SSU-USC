import {surveyCall} from '../shared/needs-assessment-client.js';
import {renderRespondent} from '../shared/survey-creator.mjs';
const surveyId=new URLSearchParams(location.search).get('id'),message=document.getElementById('surveyMessage'),mount=document.getElementById('surveyContent');
let submissionId;try{const key='usc-survey:'+surveyId;submissionId=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,submissionId)}catch{submissionId=crypto.randomUUID()}
try{const survey=await surveyCall('Public',{surveyId});if(survey.lifecycle!=='open'){message.textContent=survey.lifecycle==='scheduled'?'This survey has not opened yet.':'This survey is closed.'}else{message.textContent='No account is required. Please do not include your name, student number or other personal details.';renderRespondent(mount,survey,{submit:payload=>surveyCall('Submit',{surveyId,submissionId,...payload})})}}catch(err){message.textContent=err.message}
