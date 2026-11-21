import { studentRecordCall as call } from '../../../shared/student-records-client.js';
import { parseStudentCsv, readStudentWorkbook } from '../../../shared/student-import-file.mjs';
import { escapeHtml as e } from '../../../shared/needs-assessment-client.js';
import { SSU_PROGRAMS } from '../../student-registration/js/ssu-programs.js';
const allowed=await(globalThis.USC_AUTH_READY||Promise.resolve(false));if(allowed!==true)await new Promise(()=>{});
const $=id=>document.getElementById(id);
let preview=null,students=[],next=null,busy=false,selected=null;
const year=new Date().getFullYear();$('importYear').value=`${year}-${year+1}`;
$('programGuide').innerHTML=Object.entries(SSU_PROGRAMS).map(([d,p])=>`<details><summary>${e(d)}</summary><ul>${p.map(v=>`<li>${e(v)}</li>`).join('')}</ul></details>`).join('');
try{$('resumeImportId').value=sessionStorage.getItem('uscAnnualImportId')||'';}catch{}
function message(text,error=false){$('recordsMessage').textContent=text;$('recordsMessage').dataset.error=error;}
function refreshApply(){ $('applyStudentImport').disabled=busy||!preview||preview.hasErrors||!$('confirmImport').checked; }
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('.records-workspace button,.records-workspace input').forEach(el=>el.disabled=true);try{await fn();}catch(error){message(error.message,true);}finally{busy=false;document.querySelectorAll('.records-workspace button,.records-workspace input').forEach(el=>el.disabled=false);refreshApply();}}
function renderPreview(){
 $('importPreview').hidden=false;$('confirmImport').checked=false;
 const entries=preview.entries;preview.hasErrors=entries.some(r=>r.error);
 const created=entries.filter(r=>r.action==='create').length,updated=entries.filter(r=>r.action==='update').length;
 $('importSummary').textContent=`${entries.length} records · ${created} new accounts · ${updated} updates · ${entries.filter(r=>r.error).length} errors`;
 $('importReference').textContent=`Academic year ${preview.academicYear} · Import reference: ${preview.importId}. This preview expires after 24 hours. No omitted student is automatically deactivated.`;
 $('importPreviewRows').innerHTML=entries.map((r,i)=>{const done=preview.results?.find(x=>x.index===i);return`<tr><td>${r.line||i+2}</td><td>${e(r.row?.studentId||r.studentId)}</td><td>${e(r.row?.fullName||'—')}</td><td>${e(r.action||'Blocked')}</td><td>${e(r.row?.status||'—')}</td><td class="${r.error||done?.state==='failed'?'import-result-error':''}">${e(r.error||done?.message||done?.state||r.warning||'Ready')}${done?.emailStatus?` · Activation email: ${e(done.emailStatus)}`:''}</td></tr>`;}).join('');
 refreshApply();
}
async function list(more=false){const studentId=$('findStudentId').value.trim();const r=await call('studentRecordsList',studentId?{studentId}:more?{after:next}:{});students=more?[...students,...r.students]:r.students;next=r.next;renderStudents();}
function renderStudents(){
 const status=$('studentStatusFilter').value,rows=students.filter(s=>!status||s.studentStanding===status),year=$('importYear').value;
 $('studentListSummary').textContent=`${rows.length} shown from ${students.length} loaded records.`;
 $('studentRecordRows').innerHTML=rows.length?rows.map(s=>`<tr><td>${e(s.studentId)}</td><td>${e(s.fullName)}<br><small>${e(s.college)}</small></td><td>${e(s.academicYear||'Not recorded')}${s.academicYear!==year?'<br><span class="na-badge">Needs annual review</span>':''}</td><td>${e(s.studentStanding||'Not recorded')}</td><td>${s.isActive?'Access active':'Access blocked'} · ${e(s.accountStatus)}<br>${e(s.activationStatus||'Existing account')}${s.activationDelivery?` · Email ${e(s.activationDelivery)}`:''}</td><td><button type="button" data-student="${e(s.studentId)}">View record</button></td></tr>`).join(''):'<tr><td colspan="6">No matching student records.</td></tr>';
 $('moreStudents').hidden=!next;
}
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
function snapshot(p){if(!p)return 'No earlier academic record';return`${e(p?.academicYear||'Legacy record')} · ${e(p?.college||'—')} · ${e(p?.program||'—')} · Year ${e(p?.yearLevel||'—')} · ${e(p?.studentStanding||'—')}`;}
async function detail(studentId){
 const r=await call('studentRecordDetail',{studentId});selected=r.profile;$('studentDetailTitle').textContent=`${selected.fullName} · ${selected.studentId}`;
 $('studentProfile').innerHTML=[['Account UID',selected.uid],['Email',selected.institutionalEmail],['Department',selected.college],['Program',selected.program],['Year level',selected.yearLevel],['Academic year',selected.academicYear],['Standing',selected.studentStanding],['Account',`${selected.accountStatus} · ${selected.isActive?'Active':'Blocked'}`],['Activation',selected.activationStatus||'Existing account'],['Activation email',selected.activationDelivery||'Not applicable']].map(([k,v])=>`<p><strong>${e(k)}</strong><br>${e(v||'Not recorded')}</p>`).join('');
 $('resendStudentActivation').hidden=selected.activationStatus!=='pending';
 $('studentAcademicHistory').innerHTML=r.history.length?r.history.map(h=>`<article class="history-record"><h4>${e(h.academicYear)} · ${e(date(h.recordedAt))}</h4><p>Before: ${snapshot(h.before)}</p><p>After: ${snapshot(h.after)}</p><small>Import ${e(h.importId)}</small></article>`).join(''):'<p>No annual import history yet. Existing records have not been deleted.</p>';
 $('studentActivity').innerHTML=`<p><strong>Recorded sign-ins:</strong> ${r.signins?.count||0} · Last sign-in: ${e(date(r.signins?.lastSignInAt))}</p><h4>Complaints (${r.complaints.length})</h4>${r.complaints.length?`<ul>${r.complaints.map(c=>`<li>${e(c.subject||c.id)} · ${e(c.status)} · ${e(date(c.createdAt))}</li>`).join('')}</ul>`:'<p>No complaint records found.</p>'}<h4>Event / program registrations (${r.participation.length})</h4>${r.activityWarning?`<p class="danger-note">${e(r.activityWarning)}</p>`:''}${r.participation.length?`<ul>${r.participation.map(p=>`<li>${e(p.source)} · ${e(p.itemId)} · ${e(p.status)} · ${e(date(p.registeredAt))}</li>`).join('')}</ul>`:'<p>No registrations returned.</p>'}`;
 $('studentDetail').hidden=false;$('studentDetail').scrollIntoView({behavior:'smooth'});
}
$('studentImportForm').onsubmit=event=>{event.preventDefault();run(async()=>{
 const file=$('studentImportFile').files[0];if(!file||file.size>2*1024*1024)throw Error('Choose a CSV or .xlsx file up to 2 MB.');
 message('Validating the authorized list and checking existing accounts…');
 let rows;if(/\.csv$/i.test(file.name))rows=parseStudentCsv(await file.text());else if(/\.xlsx$/i.test(file.name))rows=await readStudentWorkbook(await file.arrayBuffer(),globalThis.ExcelJS);else throw Error('Use CSV or Excel .xlsx format.');
 preview=await call('studentAnnualPreview',{academicYear:$('importYear').value,rows,authorized:$('importAuthorized').checked});preview.results=[];
 try{sessionStorage.setItem('uscAnnualImportId',preview.importId);}catch{}$('resumeImportId').value=preview.importId;renderPreview();message(preview.hasErrors?'Correct all listed errors and upload the file again.':'Preview ready. Review every proposed change before applying.');
 });};
$('confirmImport').onchange=refreshApply;
$('studentImportFile').onchange=()=>{preview=null;$('importPreview').hidden=true;refreshApply();};
$('applyStudentImport').onclick=()=>run(async()=>{
 if(!preview||preview.hasErrors||!$('confirmImport').checked)return;
 if(!confirm(`Apply ${preview.entries.length} reviewed rows for ${preview.academicYear}? New accounts will receive activation instructions; existing passwords and email identities are preserved.`))return;
 let start=0;message('Applying reviewed import…');
 do{const r=await call('studentAnnualApply',{importId:preview.importId,start});preview.results=preview.results||[];for(const result of r.results){const i=preview.results.findIndex(x=>x.index===result.index);if(i>=0)preview.results[i]=result;else preview.results.push(result);}start=r.next;$('importProgress').textContent=`${preview.results.filter(x=>x.state==='complete').length} completed · ${preview.results.filter(x=>x.state==='failed').length} failed. Retrying this import does not create duplicate accounts.`;renderPreview();}while(start!==null);
 const failed=preview.results.filter(r=>r.state!=='complete').length;message(failed?'Import finished with failures. Review the row results and retry recoverable items.':'Import completed. Check activation email status for new accounts.');await list();
});
$('resumeImportButton').onclick=()=>run(async()=>{preview=await call('studentAnnualJob',{importId:$('resumeImportId').value.trim()});$('importYear').value=preview.academicYear;renderPreview();message('Import loaded. Review results before retrying.');});
$('studentStatusFilter').onchange=renderStudents;$('importYear').onchange=()=>{renderStudents();if(preview){preview=null;$('importPreview').hidden=true;}};
$('findStudent').onclick=()=>run(()=>list());$('clearStudentSearch').onclick=()=>run(async()=>{$('findStudentId').value='';await list();});$('refreshStudents').onclick=()=>run(()=>list());$('moreStudents').onclick=()=>run(()=>list(true));
$('studentRecordRows').onclick=event=>{const b=event.target.closest('[data-student]');if(b)run(()=>detail(b.dataset.student));};
$('resendStudentActivation').onclick=()=>run(async()=>{if(!selected||!confirm(`Send new activation instructions to ${selected.institutionalEmail}? Previous activation links will be invalidated.`))return;await call('studentActivationResend',{studentId:selected.studentId});message('Activation instructions sent.');await detail(selected.studentId);});
await run(()=>list());
