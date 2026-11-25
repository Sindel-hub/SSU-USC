import { surveyCall, surveyLink, escapeHtml as e } from '../../shared/needs-assessment-client.js';
import { summarize, csv, summaryRows } from '../../shared/needs-assessment-report.mjs';
import { SSU_PROGRAMS } from '../student-registration/js/ssu-programs.js';
import { hasOfficerPermission } from '../shared/js/officer-rbac.js';
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const $ = id => document.getElementById(id);
const departments = Object.keys(SSU_PROGRAMS);
const resultsDialog = $('naResults');
let resultsRequest = 0;
let surveys = [], next = null, statusFilter = '', editing = '', reportSurvey = null, responses = [], report = null, loading = false;
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
  field.innerHTML = `<legend>Question ${n}</legend><label for="question-${n}">Question text</label><input id="question-${n}" data-label value="${e(q.label)}" maxlength="300" required><label for="type-${n}">Answer type</label><select id="type-${n}" data-type>${[['single','Single choice'],['multiple','Multiple choice'],['rating','Rating (1–5)'],['text','Short answer']].map(([v,l]) => `<option value="${v}" ${v===q.type?'selected':''}>${l}</option>`).join('')}</select><div data-options-wrap><label for="options-${n}">Choices (one per line, 2–15)</label><textarea id="options-${n}" data-options>${e(q.options.join('\n'))}</textarea></div><label class="na-choice"><input data-required type="checkbox" ${q.required?'checked':''}>Required answer</label><button class="mini-btn light" type="button" data-remove>Remove question</button>`;
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
  const url = new URL('create-survey.html', location.href);
  if (s?.id) url.searchParams.set('id', s.id);
  else if (s?.sourceId) url.searchParams.set('copy', s.sourceId);
  location.assign(url.href);
}
const surveyDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const surveyStatuses = [
  ['open', 'Open', 'fa-circle-play'],
  ['scheduled', 'Scheduled', 'fa-calendar'],
  ['closed', 'Closed', 'fa-circle-check'],
  ['draft', 'Draft', 'fa-file-pen']
];
function renderStatusFilters() {
  const statuses = surveyStatuses.map(([key, option, icon]) => ({
    key, option, icon, count: surveys.filter(survey => survey.lifecycle === key).length
  }));
  $('naStatusFilters').innerHTML = `
    <section class="engagement-status-panel" aria-label="Survey status filters">
      <div class="engagement-status-grid">
        ${statuses.map(({ key, option, icon, count }) => `
          <button class="engagement-status-card" type="button" data-survey-status="${key}" aria-pressed="${statusFilter === key}">
            <span>${option}</span><span class="engagement-count-row"><i class="fa-solid ${icon}" aria-hidden="true"></i><strong>${count}</strong></span>
          </button>`).join('')}
      </div>
    </section>`;
}
$('naStatusFilters').addEventListener('click', event => {
  const button = event.target.closest('[data-survey-status]');
  if (!button) return;
  const status = button.dataset.surveyStatus;
  statusFilter = statusFilter === status ? '' : status;
  $('naStatusFilters').querySelectorAll('[data-survey-status]').forEach(control => {
    control.setAttribute('aria-pressed', String(control.dataset.surveyStatus === statusFilter));
  });
  renderSurveys();
});

function renderSurveys() {
  const manage = hasOfficerPermission('bulletin.manage');
  $('naNew').hidden = !manage;
  $('naEditor').hidden = true;
  const visible = statusFilter ? surveys.filter(survey => survey.lifecycle === statusFilter) : surveys;
  $('naSurveys').innerHTML = visible.length ? visible.map(survey => {
    const id = e(survey.id);
    const button = (action, label, style = 'light') => `<button class="mini-btn ${style}" type="button" data-action="${action}" data-id="${id}">${label}</button>`;
    const shareable = ['published', 'closed'].includes(survey.status);
    const canArchive = survey.status === 'draft' || (survey.lifecycle === 'closed' && survey.status !== 'archived');
    const secondary = [
      shareable ? `<a class="mini-btn light na-button" href="${e(surveyLink(survey.id))}" target="_blank" rel="noopener">Open survey</a>` : '',
      shareable && manage ? `<a class="mini-btn light na-button" href="../announcements/announcements.html?survey=${id}">Attach to announcement</a>` : '',
      manage && survey.status !== 'archived' ? button('duplicate', 'Duplicate') : '',
      manage && canArchive ? button('archive', 'Archive') : ''
    ].filter(Boolean).join('');
    return `<article class="na-survey">
      <div class="na-survey-info">
        <div class="na-survey-title"><h3>${e(survey.title)}</h3><span class="na-badge" data-status="${e(survey.lifecycle)}">${e(survey.lifecycle)}</span></div>
        <p class="na-survey-count">${survey.responseCount || 0} ${survey.responseCount === 1 ? 'response' : 'responses'}</p>
        <p class="na-survey-dates">${e(surveyDate.formatRange(new Date(survey.opensAt), new Date(survey.closesAt)))}</p>
      </div>
      <div class="na-actions">
        ${button('results', 'View Results', 'primary')}
        ${shareable ? button('link', 'Copy survey link') : ''}
        ${manage && survey.status === 'draft' ? button('edit', 'Edit') + button('publish', 'Publish') : ''}
        ${manage && survey.status === 'published' && survey.lifecycle !== 'closed' ? button('close', 'Close survey') : ''}
        ${secondary ? `<details class="na-survey-more"><summary class="mini-btn light">More actions</summary><div>${secondary}</div></details>` : ''}
      </div>
    </article>`;
  }).join('') : (statusFilter ? '<p>No surveys with this status.</p>' : '<p>No surveys yet.</p>');
  $('naMore').hidden = !next;
}
async function refresh(more = false) {
  const result=await surveyCall('List',more?{after:next}:{});surveys=more?[...surveys,...result.surveys]:result.surveys;next=result.next;renderStatusFilters();renderSurveys();
}
function updateReport() {
  const filter=$('naDepartmentFilter').value; report=summarize(reportSurvey,responses,filter);
  const departmentCount = report.departments.filter(department => department.count).length;
  $('naAnalytics').innerHTML = `
    <div class="na-stats">
      <div class="na-stat"><strong>${report.total}</strong>${filter ? 'Filtered responses' : 'Total responses'}</div>
      <div class="na-stat"><strong>${departmentCount}</strong>Departments represented</div>
    </div>
    ${!filter ? `<section class="na-analytics-section"><h3>Responses by department</h3>${pieChart(report.departments.map(({ name, count }) => ({ option: name, count })), report.total)}</section>` : ''}
    ${report.questions.map((question, index) => `<section class="na-analytics-section">
      <h3>${index + 1}. ${e(question.label)}</h3>
      <p class="na-answer-count">${question.answered} answered${question.average === null ? '' : ` · ${question.average.toFixed(2)} average`}</p>
      ${question.answered ? ['multiple','checkgrid','grid'].includes(question.type)
        ? question.counts.map(answer => bar(answer.option, answer.count, question.answered)).join('')
        : question.counts.length ? pieChart(question.counts, question.answered) : '' : '<p>No answers yet.</p>'}
      ${question.texts.length ? `<details><summary>Written responses (${question.texts.length})</summary>${question.texts.map(text => `<p class="na-text-response">${e(text)}</p>`).join('')}</details>` : ''}
    </section>`).join('')}`;
  const rows=filter?responses.filter(r=>r.department===filter):responses;
  $('naResponses').innerHTML=`${rows.length > 100 ? '<p>First 100 responses. Export the CSV for the complete list.</p>' : ''}<div class="na-table-wrap"><table class="na-table"><thead><tr><th>Department</th><th>Submitted</th><th>Answers</th></tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr><td>${e(r.department)}</td><td>${e(new Date(r.submittedAt).toLocaleString())}</td><td>${reportSurvey.questions.map(q=>`${e(q.label)}: ${e(Array.isArray(r.answers[q.id])?r.answers[q.id].join('; '):(typeof r.answers[q.id] === 'object' ? JSON.stringify(r.answers[q.id]) : r.answers[q.id]??'Skipped'))}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
}
const chartColors = ['#2563a8', '#bb421e', '#9e590c', '#217747', '#8b43a4', '#007582', '#ae3866', '#5262a0', '#765237', '#366f70', '#75404f', '#61711d', '#285e86', '#6b51a4', '#8a4d72'];
const shareFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const share = (count, total) => shareFormat.format(total ? count / total : 0);

function pieChart(choices, total) {
  if (!total) return '<p>No responses yet.</p>';
  const point = (angle, radius) => [100 + Math.sin(angle) * radius, 100 - Math.cos(angle) * radius];
  let start = 0;
  const slices = [], labels = [];
  const legend = choices.map(({ option, count }, index) => {
    const color = chartColors[index % chartColors.length];
    if (count > 0) {
      const fraction = count / total;
      const sweep = fraction * 2 * Math.PI;
      const end = start + sweep;
      const percentage = share(count, total);
      slices.push(count === total
        ? `<circle cx="100" cy="100" r="96" fill="${color}"/>`
        : `<path d="M 100 100 L ${point(start, 96).join(' ')} A 96 96 0 ${fraction > .5 ? 1 : 0} 1 ${point(end, 96).join(' ')} Z" fill="${color}" stroke="white" stroke-width="1"/>`);
      if (fraction >= .09) {
        const [x, y] = count === total ? [100, 100] : point(start + sweep / 2, 61);
        labels.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${percentage}</text>`);
      }
      start = end;
    }
    return `<li><span class="na-pie-swatch" aria-hidden="true" style="--slice-color:${color}"></span><span>${e(option)}</span><span class="na-chart-value">${count} (${share(count, total)})</span></li>`;
  });
  return `<div class="na-pie-chart">
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">${slices.join('')}${labels.join('')}</svg>
    <ul class="na-pie-legend">${legend.join('')}</ul>
  </div>`;
}

function bar(label, count, total) {
  const value = `${count} (${share(count, total)})`;
  return `<div class="na-bar"><span>${e(label)}</span><meter min="0" max="${total}" value="${count}" aria-label="${e(label)}: ${value}"></meter><span>${value}</span></div>`;
}
async function loadResults(survey) {
  const request = ++resultsRequest;
  $('naResultsTitle').textContent = survey.title;
  $('naResultsContent').hidden = true;
  $('naResultsStatus').textContent = 'Loading results…';
  $('naRawResponses').open = false;
  $('naResults').querySelector('.na-results-scroll').scrollTop = 0;
  if (!resultsDialog.open) resultsDialog.showModal();
  const all = [];
  let after = null, result;
  try {
    do {
      result = await surveyCall('Responses', { surveyId: survey.id, after });
      if (request !== resultsRequest || !resultsDialog.open) return;
      all.push(...result.responses);
      after = result.next;
    } while (after);
    reportSurvey = result.survey;
    responses = all;
    $('naDepartmentFilter').innerHTML = '<option value="">All departments</option>' + reportSurvey.departments.map(d => `<option>${e(d)}</option>`).join('');
    updateReport();
    $('naResultsStatus').textContent = '';
    $('naResultsContent').hidden = false;
  } catch (error) {
    if (request === resultsRequest && resultsDialog.open) $('naResultsStatus').textContent = error.message || 'Unable to load survey results.';
  }
}
resultsDialog.addEventListener('close', () => { if (!resultsDialog.open) resultsRequest++; });
function download(rows,name) { const url=URL.createObjectURL(new Blob([csv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
const editor = $('naEditor');
$('naNew').onclick = () => edit();
$('naCancel').onclick = () => { editor.open = false; $('naNew').focus(); };
editor.querySelector('summary').addEventListener('click', event => {
  if (!editor.open) {
    event.preventDefault();
    edit();
  }
});
editor.addEventListener('toggle', () => {
  $('naNew').setAttribute('aria-expanded', String(editor.open));
  if (!editor.open) $('naEditorTitle').textContent = 'Create survey';
});
$('naAddQuestion').onclick=()=>{if($('naQuestions').children.length>=30)return message('Maximum 30 questions.',true);addQuestion();};
$('naForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  const input={title:$('naTitle').value,description:$('naDescription').value,opensAt:new Date($('naOpens').value).getTime(),closesAt:new Date($('naCloses').value).getTime(),departments:[...$('naDepartments').querySelectorAll('input:checked')].map(x=>x.value),questions:[...$('naQuestions').children].map(f=>({label:f.querySelector('[data-label]').value,type:f.querySelector('[data-type]').value,options:f.querySelector('[data-options]').value.split('\n').map(x=>x.trim()).filter(Boolean),required:f.querySelector('[data-required]').checked}))};
  await surveyCall('Manage',{action:'save',surveyId:editing||undefined,input});editor.open = false;await refresh();message('Draft saved. Publish when you are ready.');
});};
$('naSurveys').onclick=event=>{const b = event.target.closest('button[data-action]');
  if (!b) return;
  const s = surveys.find(survey => survey.id === b.dataset.id), action = b.dataset.action;
  if (!s) return;
  if (action === 'results') { void loadResults(s); return; }
  run(async()=>{
  if(action==='edit')return edit(s);
  if(action==='duplicate'){edit({sourceId:s.id});return;}
  if(action==='link'){try{await navigator.clipboard.writeText(surveyLink(s.id));message('Survey link copied.');}catch{message(`Survey link: ${surveyLink(s.id)}`);}return;}
  if(!confirm(`${action[0].toUpperCase()+action.slice(1)} “${s.title}”?${action==='publish'?' Questions and target departments will be locked.':''}`))return;
  await surveyCall('Manage',{action,surveyId:s.id});await refresh();message('Survey updated.');
});};
$('naRefresh').onclick=()=>run(()=>refresh());$('naMore').onclick=()=>run(()=>refresh(true));
$('naDepartmentFilter').onchange=updateReport;$('naPrint').onclick=()=>window.print();
$('naExportSummary').onclick=()=>download(summaryRows(report),'needs-assessment-summary.csv');
$('naExportResponses').onclick=()=>{const d=$('naDepartmentFilter').value;download([['Department','Submitted',...reportSurvey.questions.map(q=>q.label)],...responses.filter(r=>!d||r.department===d).map(r=>[r.department,new Date(r.submittedAt).toISOString(),...reportSurvey.questions.map(q=>Array.isArray(r.answers[q.id])?r.answers[q.id].join('; '):(typeof r.answers[q.id] === 'object' ? JSON.stringify(r.answers[q.id]) : r.answers[q.id]??''))])],'needs-assessment-responses.csv');};
await run(()=>refresh());
