import { surveyCall, surveyLink, escapeHtml as e } from '../../shared/needs-assessment-client.js';
import { summarize, csv, summaryRows } from '../../shared/needs-assessment-report.mjs';
import { SSU_PROGRAMS } from '../student-registration/js/ssu-programs.js';
import { hasOfficerPermission } from '../shared/js/officer-rbac.js';
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const $ = id => document.getElementById(id);
const departments = Object.keys(SSU_PROGRAMS);
let surveys = [], next = null, editing = '', reportSurvey = null, responses = [], report = null, loading = false;
function message(text, error = false) { $('naMessage').textContent = text; $('naMessage').dataset.error = error; }
async function run(task) {
  if (loading) return;
  loading = true;
  try { await task(); } catch (error) { message(error.message, true); }
  finally { loading = false; }
}
function addQuestion(q = { label:'', type:'single', options:[], required:true }) {
  const field = document.createElement('fieldset'); field.className = 'na-question';
  const n = $('naQuestions').children.length + 1;
  field.innerHTML = `<legend>Question ${n}</legend><label for="question-${n}">Question text</label><input id="question-${n}" data-label value="${e(q.label)}" maxlength="300" required><label for="type-${n}">Answer type</label><select id="type-${n}" data-type>${[['single','Single choice'],['multiple','Multiple choice'],['rating','Rating (1–5)'],['text','Short answer']].map(([v,l]) => `<option value="${v}" ${v===q.type?'selected':''}>${l}</option>`).join('')}</select><div data-options-wrap><label for="options-${n}">Choices (one per line, 2–15)</label><textarea id="options-${n}" data-options>${e(q.options.join('\n'))}</textarea></div><label class="na-choice"><input data-required type="checkbox" ${q.required?'checked':''}>Required answer</label><button type="button" data-remove>Remove question</button>`;
  const toggle = () => { const show = ['single','multiple'].includes(field.querySelector('[data-type]').value); field.querySelector('[data-options-wrap]').hidden = !show; field.querySelector('[data-options]').required = show; };
  field.querySelector('[data-type]').addEventListener('change',toggle); toggle();
  field.querySelector('[data-remove]').onclick = () => { field.remove(); renumber(); };
  $('naQuestions').append(field);
}
function renumber() {
  [...$('naQuestions').children].forEach((field,i) => {
    const n=i+1; field.querySelector('legend').textContent=`Question ${n}`;
    for (const [selector,prefix] of [['[data-label]','question'],['[data-type]','type'],['[data-options]','options']]) {
      const control=field.querySelector(selector), label=field.querySelector(`label[for="${control.id}"]`);control.id=`${prefix}-${n}`;label.htmlFor=control.id;
    }
  });
}
function edit(s = null) {
  editing = s?.id || ''; $('naEditorTitle').textContent = s ? 'Edit draft' : 'Create survey';
  $('naTitle').value = s?.title || ''; $('naDescription').value=s?.description || '';
  const local = ms => { const d=new Date(ms); return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  $('naOpens').value=local(s?.opensAt || Date.now()); $('naCloses').value=local(s?.closesAt || Date.now()+7*86400000);
  $('naDepartments').innerHTML=departments.map(d=>`<label class="na-choice"><input type="checkbox" value="${e(d)}" ${!s || s.departments.includes(d)?'checked':''}>${e(d)}</label>`).join('');
  $('naQuestions').replaceChildren(); (s?.questions || [{label:'',type:'single',options:[],required:true}]).forEach(addQuestion);
  $('naEditor').hidden=false; $('naTitle').focus();
}
function renderSurveys() {
  const manage=hasOfficerPermission('bulletin.manage'); $('naNew').hidden=!manage;
  $('naSurveys').innerHTML=surveys.length ? surveys.map(s=>`<article class="na-survey"><div><h3>${e(s.title)}</h3><span class="na-badge">${e(s.lifecycle)}</span><p class="na-muted">${s.responseCount || 0} responses · ${e(s.departments.join(', '))}</p><p class="na-muted">${e(new Date(s.opensAt).toLocaleString())} – ${e(new Date(s.closesAt).toLocaleString())}</p></div><div class="na-actions">${s.status==='draft'&&manage?`<button data-action="edit" data-id="${s.id}">Edit</button><button data-action="publish" data-id="${s.id}">Publish</button>`:''}${s.status==='published'&&manage?`<button data-action="close" data-id="${s.id}">Close</button>`:''}${s.status!=='draft'&&s.status!=='archived'?`<button data-action="link" data-id="${s.id}">Copy survey link</button>${manage?`<a class="na-button" href="../announcements/announcements.html?survey=${s.id}">Attach to announcement</a>`:''}`:''}<button data-action="results" data-id="${s.id}">View results</button>${manage&&s.status!=='archived'?`<button data-action="duplicate" data-id="${s.id}">Duplicate</button>${s.lifecycle==='closed'||s.status==='draft'?`<button data-action="archive" data-id="${s.id}">Archive</button>`:''}`:''}</div></article>`).join('') : '<p>No surveys yet. Create a survey to start listening to students.</p>';
  $('naMore').hidden=!next;
}
async function refresh(more = false) {
  const result=await surveyCall('List',more?{after:next}:{});surveys=more?[...surveys,...result.surveys]:result.surveys;next=result.next;renderSurveys();
}
function updateReport() {
  const filter=$('naDepartmentFilter').value; report=summarize(reportSurvey,responses,filter);
  $('naReportMeta').textContent=`${filter || 'All departments'} · Generated ${new Date().toLocaleString()} · Anonymous, self-reported responses. Multiple choice totals can exceed response counts.`;
  $('naAnalytics').innerHTML=`<div class="na-stats"><div class="na-stat"><strong>${report.total}</strong>Responses</div><div class="na-stat"><strong>${report.departments.filter(d=>d.count).length}</strong>Departments represented</div></div><h3>Responses by department</h3>${report.departments.map(d=>bar(d.name,d.count,report.total)).join('')}${report.questions.map(q=>`<section class="na-question"><h3>${e(q.label)}</h3><p>${q.answered} answered${q.average===null?'':` · Average ${q.average.toFixed(2)} / 5`}</p>${q.counts.map(c=>bar(c.option,c.count,q.answered)).join('')}${q.texts.length?`<details><summary>View ${q.texts.length} written responses</summary>${q.texts.map(t=>`<p class="na-text-response">${e(t)}</p>`).join('')}</details>`:''}${!q.answered?'<p>No answers yet.</p>':''}</section>`).join('')}`;
  const rows=filter?responses.filter(r=>r.department===filter):responses;
  $('naResponses').innerHTML=`<p>Showing the first ${Math.min(rows.length,100)} of ${rows.length} responses. Export CSV for all collected responses.</p><div class="na-table-wrap"><table class="na-table"><thead><tr><th>Department</th><th>Submitted</th><th>Answers</th></tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr><td>${e(r.department)}</td><td>${e(new Date(r.submittedAt).toLocaleString())}</td><td>${reportSurvey.questions.map(q=>`${e(q.label)}: ${e(Array.isArray(r.answers[q.id])?r.answers[q.id].join('; '):r.answers[q.id]??'Skipped')}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
}
function bar(label,count,total) { return `<div class="na-bar"><span>${e(label)}</span><meter min="0" max="${Math.max(total,1)}" value="${count}" aria-label="${e(label)}: ${count}"></meter><span>${count}</span></div>`; }
async function loadResults(id) {
  $('naResults').hidden=true; message('Loading complete results…');const all=[]; let after=null,result;
  do { result=await surveyCall('Responses',{surveyId:id,after});all.push(...result.responses);after=result.next; } while(after);
  reportSurvey=result.survey;responses=all;
  $('naResultsTitle').textContent=reportSurvey.title;
  $('naDepartmentFilter').innerHTML='<option value="">All departments</option>'+reportSurvey.departments.map(d=>`<option>${e(d)}</option>`).join('');
  updateReport();$('naResults').hidden=false;$('naResults').scrollIntoView({behavior:'smooth'});message('Results loaded. Refresh to include new submissions.');
}
function download(rows,name) { const url=URL.createObjectURL(new Blob([csv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
$('naNew').onclick=()=>edit();$('naCancel').onclick=()=>{$('naEditor').hidden=true;};
$('naAddQuestion').onclick=()=>{if($('naQuestions').children.length>=30)return message('Maximum 30 questions.',true);addQuestion();};
$('naForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  const input={title:$('naTitle').value,description:$('naDescription').value,opensAt:new Date($('naOpens').value).getTime(),closesAt:new Date($('naCloses').value).getTime(),departments:[...$('naDepartments').querySelectorAll('input:checked')].map(x=>x.value),questions:[...$('naQuestions').children].map(f=>({label:f.querySelector('[data-label]').value,type:f.querySelector('[data-type]').value,options:f.querySelector('[data-options]').value.split('\n').map(x=>x.trim()).filter(Boolean),required:f.querySelector('[data-required]').checked}))};
  await surveyCall('Manage',{action:'save',surveyId:editing||undefined,input});$('naEditor').hidden=true;await refresh();message('Draft saved. Publish when you are ready.');
});};
$('naSurveys').onclick=event=>{const b=event.target.closest('button[data-action]');if(!b)return;run(async()=>{
  const s=surveys.find(x=>x.id===b.dataset.id),action=b.dataset.action;
  if(action==='edit')return edit(s);
  if(action==='duplicate'){edit({...s,id:'',title:`${s.title} (copy)`,opensAt:Date.now(),closesAt:Date.now()+7*86400000});return;}
  if(action==='link'){try{await navigator.clipboard.writeText(surveyLink(s.id));message('Survey link copied.');}catch{message(`Survey link: ${surveyLink(s.id)}`);}return;}
  if(action==='results')return loadResults(s.id);
  if(!confirm(`${action[0].toUpperCase()+action.slice(1)} “${s.title}”?${action==='publish'?' Questions and target departments will be locked.':''}`))return;
  await surveyCall('Manage',{action,surveyId:s.id});await refresh();message('Survey updated.');
});};
$('naRefresh').onclick=()=>run(async()=>{await refresh();if(reportSurvey)await loadResults(reportSurvey.id);});$('naMore').onclick=()=>run(()=>refresh(true));
$('naDepartmentFilter').onchange=updateReport;$('naPrint').onclick=()=>window.print();
$('naExportSummary').onclick=()=>download(summaryRows(report),'needs-assessment-summary.csv');
$('naExportResponses').onclick=()=>{const d=$('naDepartmentFilter').value;download([['Department','Submitted',...reportSurvey.questions.map(q=>q.label)],...responses.filter(r=>!d||r.department===d).map(r=>[r.department,new Date(r.submittedAt).toISOString(),...reportSurvey.questions.map(q=>Array.isArray(r.answers[q.id])?r.answers[q.id].join('; '):r.answers[q.id]??'')])],'needs-assessment-responses.csv');};
await run(()=>refresh());
