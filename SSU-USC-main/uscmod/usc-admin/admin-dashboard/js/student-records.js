import { studentRecordCall as call } from '../../../shared/student-records-client.js';
import { parseStudentCsv, readStudentWorkbook } from '../../../shared/student-import-file.mjs';
import { escapeHtml as e } from '../../../shared/needs-assessment-client.js';
import { SSU_PROGRAMS, formatSsuCollege, formatSsuProgram } from '../../student-registration/js/ssu-programs.js';
const allowed=await(globalThis.USC_AUTH_READY||Promise.resolve(false));if(allowed!==true)await new Promise(()=>{});
const $=id=>document.getElementById(id);
let reviewTab=false,preview=null,students=[],next=null,busy=false,selected=null;
let directoryRequest=0,directoryTimer=null,directoryLoading=false;
let recordOpener=null;
const detailDialog=$('studentDetail');
const directoryDialog=$('studentDirectoryDialog');
$('openStudentDirectory').onclick=()=>{if(!directoryDialog.open){directoryDialog.showModal();document.documentElement.classList.add('student-directory-modal-open');$('findStudentId').focus();}};
$('closeStudentDirectory').onclick=()=>directoryDialog.close();
directoryDialog.addEventListener('close',()=>{document.documentElement.classList.remove('student-directory-modal-open');$('openStudentDirectory').focus({preventScroll:true});});

$('closeStudentDetail').onclick=()=>detailDialog.close();
detailDialog.addEventListener('close',()=>{document.documentElement.classList.remove('student-record-modal-open');recordOpener?.focus({preventScroll:true});});
const year=new Date().getFullYear();$('importYear').value=`${year}-${year+1}`;
$('programGuide').innerHTML=Object.entries(SSU_PROGRAMS).map(([d,p])=>`<details><summary>${e(formatSsuCollege(d))}</summary><ul>${p.map(v=>`<li>${e(v)}</li>`).join('')}</ul></details>`).join('');
try{$('resumeImportId').value=sessionStorage.getItem('uscAnnualImportId')||'';}catch{}
function message(text,error=false){$('recordsMessage').textContent=text;$('recordsMessage').dataset.error=error;}
function readyCount(){return preview?.entries.filter(row=>!row.error).length||0;}
function refreshApply(){ $('applyStudentImport').disabled=busy||preview?.status!=='records-preview'||!readyCount()||!$('confirmImport').checked; }
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('.records-workspace button:not([data-record-close]),.records-workspace input,.records-workspace textarea,.records-workspace select').forEach(el=>el.disabled=true);try{await fn();}catch(error){message(error.message,true);}finally{busy=false;document.querySelectorAll('.records-workspace button:not([data-record-close]),.records-workspace input,.records-workspace textarea,.records-workspace select').forEach(el=>el.disabled=false);refreshApply();if(!detailDialog.open&&document.activeElement===document.body)recordOpener?.focus({preventScroll:true});}}
function renderPreview(){
 $('importPreview').hidden=false;
 const entries=preview.entries,ready=readyCount(),blocked=entries.length-ready;
 $('importSummary').textContent=`${ready} ready · ${blocked} need review`;
 $('importReference').textContent=`Academic year ${preview.academicYear} · Import reference: ${preview.importId}${preview.correction?' · CORRECTION: '+preview.correctionReason:''}${preview.restoreAccess?' · Review all access-restoration actions.':''}${entries.some(entry=>['graduated','dropped'].includes(entry.row?.studentStatus))?' · Graduated / Dropped rows revoke linked account access.':''}`;
 for(const [id,label,count,pressed] of [['readyImportTab','Ready',ready,!reviewTab],['reviewImportTab','Needs Review',blocked,reviewTab]]){
  $(id).textContent=`${label} (${count})`;
  $(id).setAttribute('aria-pressed',pressed);
 }
 const results=new Map((preview.results||[]).map(result=>[result.index,result]));
 const actionLabels={'drop-disable-access':'Mark dropped · disable access','mark-dropped':'Mark dropped','correct-and-restore-access':'Correct record & restore access','correct-academic-record':'Correct academic record'};
 $('importPreviewRows').innerHTML=entries.map((row,index)=>{
  if(Boolean(row.error)!==reviewTab)return '';
  const done=results.get(index);
  const review=row.reviewName?`<div>On file: ${e(row.reviewName)}</div><button type="button" data-verify-row="${index}">Verify same person</button>`:'';
  return `<tr><td>${row.line||index+2}</td><td>${e(row.row?.studentId||row.studentId)}</td><td>${e(row.row?.fullName||'—')}${review}</td><td>${e(row.error?'Blocked':actionLabels[row.action]||row.action)}</td><td>${e(row.row?.enrollmentStatus||'—')}</td><td>${e(row.error||done?.message||done?.state||row.warning||'Ready')}</td></tr>`;
 }).join('')||'<tr><td colspan="6">No rows in this tab.</td></tr>';
 refreshApply();
}
$('readyImportTab').onclick=()=>{reviewTab=false;renderPreview();};
$('reviewImportTab').onclick=()=>{reviewTab=true;renderPreview();};
$('importPreviewRows').onclick=event=>{
 const control=event.target.closest('[data-verify-row]');
 if(!control||!preview)return;
 run(async()=>{
  const index=Number(control.dataset.verifyRow),row=preview.entries[index];
  const reference=prompt(`Confirm these names belong to the same person for Student ID ${row.row.studentId}. Enter the verified in-person or authorized record reference.\n\nSCL: ${row.row.fullName}\nOn file: ${row.reviewName}`);
  if(reference===null)return;
  await call('studentAnnualResolve',{importId:preview.importId,index,samePerson:true,verificationReference:reference.trim()});
  preview=await call('studentAnnualJob',{importId:preview.importId});
  $('confirmImport').checked=false;
  reviewTab=false;
  renderPreview();
  message('Identity verified. Review the row in Ready before applying it.');
 });
};
async function list(more=false){
 clearTimeout(directoryTimer);
 const request=++directoryRequest;
 const studentId=$('findStudentId').value.trim();
 const filters={studentStanding:$('studentStatusFilter').value,studentId};
 let cursor=more?next:null,found=[];
 if(!more){students=[];next=null;$('studentRecordRows').replaceChildren();}
 directoryLoading=true;$('moreStudents').hidden=true;
 $('studentListSummary').textContent='Searching student records…';
 try{
  do{
   const result=await call('studentRecordsList',{filters,...(cursor?{after:cursor}:{})});
   if(request!==directoryRequest)return;
   found=result.students;cursor=result.next;
  }while(!found.length&&cursor);
  students=more?[...students,...found]:found;next=cursor;renderStudents();
 }catch(error){if(request===directoryRequest){$('studentListSummary').textContent=error.message||'Unable to search records. Please try again.';$('moreStudents').hidden=!next;}}
 finally{if(request===directoryRequest)directoryLoading=false;}
}
function scheduleDirectorySearch(delay=0){
 clearTimeout(directoryTimer);++directoryRequest;directoryLoading=true;
 students=[];next=null;$('studentRecordRows').replaceChildren();$('moreStudents').hidden=true;
 $('studentListSummary').textContent='Searching student records…';
 if(delay)directoryTimer=setTimeout(()=>void list(),delay);else void list();
}
function renderStudents(){
 const rows=students;
 $('studentListSummary').textContent=`${rows.length} matching record${rows.length===1?'':'s'} shown${next?' · more records may be available':''}.`;
 $('studentRecordRows').innerHTML=rows.length?rows.map(s=>`<tr><td>${e(s.studentId)}</td><td>${e(s.fullName)}<br><small>${e(formatSsuCollege(s.college))}</small></td><td>${e(s.academicYear||'Not recorded')}</td><td>${e(standingLabel(s.studentStanding))}</td><td>${e(s.accountState)}<br>${e(s.activationStatus||'Existing account')}${s.activationDelivery?` · ${e(s.activationDelivery)}`:''}</td><td><button type="button" data-student="${e(s.studentId)}">View record</button></td></tr>`).join(''):'<tr><td colspan="6">No matching student records.</td></tr>';
 $('moreStudents').hidden=!next;
}
const standingLabel=value=>({active:'Currently enrolled',graduated:'Graduated',dropped:'Dropped',inactive:'Inactive',withdrawn:'Discontinued',leave:'On leave',transferred:'Transferred',eliminated:'Eliminated'})[value]||'Not recorded';
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
function snapshot(p){if(!p)return 'No earlier academic record';return`${e(p?.academicYear||'Legacy record')} · ${e(formatSsuCollege(p?.college)||'—')} · ${e(formatSsuProgram(p?.college,p?.program)||'—')} · Year ${e(p?.yearLevel||'—')} · ${e(p?.studentStanding||'—')}`;}
async function detail(studentId){
 $('studentDetailTitle').textContent='Student record';
 $('studentDetailStatus').textContent='Loading student record…';
 $('studentProfile').replaceChildren();$('studentAcademicHistory').replaceChildren();$('studentActivity').replaceChildren();$('resendStudentActivation').hidden=true;$('recordStandingForm').hidden=true;
 if(!detailDialog.open){document.documentElement.classList.add('student-record-modal-open');detailDialog.showModal();}
 let r;
 try{r=await call('studentRecordDetail',{studentId});}catch(error){$('studentDetailStatus').textContent=error.message||'The student record could not be loaded. Close this window and try again.';throw error;}
 $('studentDetailStatus').textContent='';selected=r.profile;$('studentDetailTitle').textContent=`${selected.fullName} · ${selected.studentId}`;
 $('studentProfile').innerHTML=[['Record ID',selected.uid],['Account UID',selected.accountUid],['Email',selected.institutionalEmail],['Department',formatSsuCollege(selected.college)],['Program',formatSsuProgram(selected.college,selected.program)],['Year level',selected.yearLevel],['Academic year',selected.academicYear],['Enrollment classification',selected.enrollmentStatus],['Student status',standingLabel(selected.studentStanding)],['Account',selected.accountState],['Activation',selected.activationStatus||'Existing account'],['Activation delivery',selected.activationDelivery||'Not applicable']].map(([k,v])=>`<p><strong>${e(k)}</strong><br>${e(v||'Not recorded')}</p>`).join('');
 $('resendStudentActivation').hidden=selected.activationStatus!=='pending'||!selected.institutionalEmail;
 $('recordStandingForm').hidden=Boolean(selected.accountUid);
 $('recordStanding').value=selected.studentStanding||'active';
 $('studentAcademicHistory').innerHTML=r.history.length?r.history.map(h=>`<article class="history-record"><h4>${e(h.academicYear)} · ${e(date(h.recordedAt))}</h4><p>Before: ${snapshot(h.before)}</p><p>After: ${snapshot(h.after)}</p><small>Import ${e(h.importId)}</small></article>`).join(''):'<p>No annual import history yet. Existing records have not been deleted.</p>';
 $('studentActivity').innerHTML=`<p><strong>Recorded sign-ins:</strong> ${r.signins?.count||0} · Last sign-in: ${e(date(r.signins?.lastSignInAt))}</p><h4>Complaints (${r.complaints.length})</h4>${r.complaints.length?`<ul>${r.complaints.map(c=>`<li>${e(c.subject||c.id)} · ${e(c.status)} · ${e(date(c.createdAt))}</li>`).join('')}</ul>`:'<p>No complaint records found.</p>'}<h4>Event / program registrations (${r.participation.length})</h4>${r.activityWarning?`<p class="danger-note">${e(r.activityWarning)}</p>`:''}${r.participation.length?`<ul>${r.participation.map(p=>`<li>${e(p.source)} · ${e(p.itemId)} · ${e(p.status)} · ${e(date(p.registeredAt))}</li>`).join('')}</ul>`:'<p>No registrations returned.</p>'}`;
 $('studentDetail').querySelector('.student-record-modal-body').scrollTop=0;
}
$('studentImportForm').onsubmit=event=>{event.preventDefault();run(async()=>{
 const file=$('studentImportFile').files[0];if(!file||file.size>2*1024*1024)throw Error('Choose a CSV or .xlsx file up to 2 MB.');
 message('Validating the authorized list and checking existing accounts…');
 let rows;if(/\.csv$/i.test(file.name))rows=parseStudentCsv(await file.text());else if(/\.xlsx$/i.test(file.name))rows=await readStudentWorkbook(await file.arrayBuffer(),globalThis.ExcelJS);else throw Error('Use CSV or Excel .xlsx format.');
 preview=await call('studentAnnualPreview',{academicYear:$('importYear').value,rows,authorized:$('importAuthorized').checked,correction:$('correctionMode').checked,correctionReason:$('correctionReason').value,restoreAccess:$('restoreImportAccess').checked});preview.results=[];$('importProgress').textContent='';reviewTab=false;$('confirmImport').checked=false;
 try{sessionStorage.setItem('uscAnnualImportId',preview.importId);}catch{}$('resumeImportId').value=preview.importId;renderPreview();message(preview.hasErrors?'Apply the Ready rows separately. Correct spreadsheet errors and upload the corrected rows for a new preview.':'Preview ready. Review the records before applying.');
 });};
$('confirmImport').onchange=refreshApply;
function invalidatePreview(){preview=null;$('importProgress').textContent='';$('importPreview').hidden=true;$('confirmImport').checked=false;refreshApply();}
function syncCorrectionFields(){const enabled=$('correctionMode').checked;$('correctionFields').hidden=!enabled;$('correctionReason').required=enabled;if(!enabled)$('restoreImportAccess').checked=false;}
$('correctionMode').onchange=()=>{syncCorrectionFields();invalidatePreview();};
$('correctionReason').oninput=invalidatePreview;
$('restoreImportAccess').onchange=invalidatePreview;
$('importYear').oninput=invalidatePreview;
$('studentImportFile').onchange=invalidatePreview;
$('applyStudentImport').onclick=()=>run(async()=>{
 if(!preview||!readyCount()||!$('confirmImport').checked)return;
 if(!confirm(`Apply ${readyCount()} Ready records for ${preview.academicYear}?${preview.correction?' This corrects academic records; review the target year.':''}${preview.restoreAccess?' Explicitly marked approved import-disabled accounts will regain portal access.':''}`))return;
 let start=0;message('Applying reviewed import…');
 do{const r=await call('studentAnnualApply',{importId:preview.importId,start,confirmed:true});preview.results=preview.results||[];for(const result of r.results){const i=preview.results.findIndex(x=>x.index===result.index);if(i>=0)preview.results[i]=result;else preview.results.push(result);}start=r.next;$('importProgress').textContent=`${preview.results.filter(x=>x.state==='complete').length} completed · ${preview.results.filter(x=>x.state==='failed').length} failed. `;renderPreview();}while(start!==null);
 const failed=preview.results.filter(r=>r.state!=='complete').length;message(failed?'Import finished with failures. Review the row results and retry recoverable items.':'Ready records applied.');await list();
});
$('resumeImportButton').onclick=()=>run(async()=>{preview=await call('studentAnnualJob',{importId:$('resumeImportId').value.trim()});$('importYear').value=preview.academicYear;$('correctionMode').checked=preview.correction===true;$('correctionReason').value=preview.correctionReason||'';$('restoreImportAccess').checked=preview.restoreAccess===true;syncCorrectionFields();$('confirmImport').checked=false;reviewTab=false;renderPreview();message('Import loaded. Review results before retrying.');});
$('studentStatusFilter').onchange=()=>scheduleDirectorySearch();
$('findStudentId').addEventListener('input',()=>scheduleDirectorySearch(250));
$('findStudentId').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();scheduleDirectorySearch();}});
$('importYear').onchange=()=>{renderStudents();if(preview){preview=null;$('importPreview').hidden=true;}};
$('findStudent').onclick=()=>scheduleDirectorySearch();$('clearStudentSearch').onclick=()=>{
 for(const field of document.querySelectorAll('#findStudentId, #studentStatusFilter'))field.value='';
 scheduleDirectorySearch();$('findStudentId').focus();
};$('refreshStudents').onclick=()=>scheduleDirectorySearch();$('moreStudents').onclick=()=>{if(!directoryLoading&&next)void list(true);};
$('studentRecordRows').onclick=event=>{const b=event.target.closest('[data-student]');if(b){recordOpener=b;run(()=>detail(b.dataset.student));}};
$('resendStudentActivation').onclick=()=>run(async()=>{if(!selected||!confirm(`Send new activation instructions to ${selected.institutionalEmail}? Previous activation links will be invalidated.`))return;await call('studentActivationResend',{studentId:selected.studentId});message('Activation instructions sent.');await detail(selected.studentId);$('studentDetailStatus').textContent='Activation instructions sent.';});
$('recordStandingForm').onsubmit=event=>{event.preventDefault();run(async()=>{
 const {studentId}=selected;
 await call('studentRecordSetStanding',{studentId,standing:$('recordStanding').value});
 await detail(studentId);
 $('studentDetailStatus').textContent='Student status saved.';
 await list();
});};
await run(()=>list());
