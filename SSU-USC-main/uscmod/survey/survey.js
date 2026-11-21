import { surveyCall, escapeHtml as e } from '../shared/needs-assessment-client.js';
const $ = id => document.getElementById(id);
const surveyId = new URLSearchParams(location.search).get('id');
const message = (text, error = false) => { $('surveyMessage').textContent = text; $('surveyMessage').dataset.error = error; };
let survey, submissionId;
const key = `usc-survey:${surveyId}`;
try {
  submissionId = localStorage.getItem(key) || crypto.randomUUID();
  localStorage.setItem(key, submissionId);
} catch { submissionId = crypto.randomUUID(); }
function renderQuestion(q, index) {
  let control;
  if (q.type === 'text') control = `<textarea name="${q.id}" maxlength="2000" ${q.required ? 'required' : ''} aria-label="${e(q.label)}"></textarea>`;
  else if (q.type === 'rating') control = `<select name="${q.id}" ${q.required ? 'required' : ''} aria-label="${e(q.label)}"><option value="">Choose a rating</option>${[1,2,3,4,5].map(n => `<option value="${n}">${n}${n === 1 ? ' — Lowest' : n === 5 ? ' — Highest' : ''}</option>`).join('')}</select>`;
  else control = q.options.map((option,i) => `<label class="na-choice"><input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="${q.id}" value="${e(option)}" ${q.type === 'single' && q.required && i === 0 ? 'required' : ''}>${e(option)}</label>`).join('');
  return `<fieldset class="na-question"><legend>${index + 1}. ${e(q.label)} ${q.required ? '(Required)' : '(Optional)'}</legend>${control}</fieldset>`;
}
try {
  survey = await surveyCall('Public', { surveyId });
  $('surveyTitle').textContent = survey.title;
  $('surveyDescription').textContent = survey.description;
  $('surveySchedule').textContent = `${new Date(survey.opensAt).toLocaleString()} – ${new Date(survey.closesAt).toLocaleString()} (your local time)`;
  if (survey.lifecycle !== 'open') message(survey.lifecycle === 'scheduled' ? 'This survey has not opened yet.' : 'This survey is closed. Thank you for your interest.');
  else {
    $('surveyDepartment').insertAdjacentHTML('beforeend', survey.departments.map(d => `<option>${e(d)}</option>`).join(''));
    $('surveyQuestions').innerHTML = survey.questions.map(renderQuestion).join('');
    $('surveyForm').hidden = false;
  }
} catch (error) { $('surveyTitle').textContent = 'Survey unavailable'; message(error.message, true); }
$('surveyForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('surveySubmit').disabled = true;
  message('Submitting…');
  const form = new FormData(event.target), answers = {};
  for (const q of survey.questions) {
    const v = q.type === 'multiple' ? form.getAll(q.id) : form.get(q.id);
    if (q.type === 'rating' && v) answers[q.id] = Number(v);
    else if (v && (!Array.isArray(v) || v.length)) answers[q.id] = v;
  }
  try {
    await surveyCall('Submit', { surveyId, submissionId, department: form.get('department') || $('surveyDepartment').value, answers });
    $('surveyForm').hidden = true; message(''); $('surveyConfirmation').hidden = false; $('surveyConfirmation').focus();
  } catch (error) { message(error.message, true); }
  finally { $('surveySubmit').disabled = false; }
});
