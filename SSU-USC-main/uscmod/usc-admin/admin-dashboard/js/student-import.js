import { auth, functions } from '../../../firebase/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-functions.js';
import { SSU_PROGRAMS } from '../../student-registration/js/ssu-programs.js';
import { IMPORT_FIELDS, detectColumns, mapRows, csvContent, importSummary } from './student-import-model.mjs';
const el=id=>document.getElementById(id), dialog=el('studentImportDialog');
let matrix=[],rows=[],file=null,busy=false,worker=null,generation=0,resultsMode=false,returnFocus=null;
const controls=['studentImportFile','importSheet','previewStudentImport','confirmStudentImport','closeStudentImportButton','restartStudentImport','downloadStudentImportTemplate','importDefaultCollege','importDefaultProgram','importDefaultYear'];
const statuses={unchecked:'Unchecked',ready:'Eligible',duplicate:'Duplicate in file',existing:'Already registered',invalid:'Invalid',created:'Created',failed:'Failed',unconfirmed:'Unconfirmed'};
function feedback(text,error=false){el('importFeedback').textContent=text;el('importFeedback').dataset.error=String(error);}
function setBusy(value){busy=value;dialog.setAttribute('aria-busy',String(value));for(const id of controls)el(id).disabled=value;el('previewStudentImport').disabled=value || !matrix.length;dialog.querySelectorAll('[data-map]').forEach(e=>e.disabled=value);}
function reset(){generation++;worker?.terminate();worker=null;file=null;matrix=[];rows=[];resultsMode=false;el('studentImportFile').value='';el('importTableBody').replaceChildren();el('importTableHead').replaceChildren();el('importMapping').replaceChildren();for(const id of ['importMappingSection','importReview','importCredentialWarning','confirmStudentImport','exportStudentCredentials','exportStudentImportReport','restartStudentImport','studentImportProgress'])el(id).hidden=true;el('importSetup').hidden=false;el('previewStudentImport').hidden=false;el('importDefaultCollege').value='';el('importDefaultProgram').replaceChildren(new Option('No default',''));el('importDefaultYear').value='';feedback('');setBusy(false);}
function close(){if(busy)return;if(rows.some(r=>r.temporaryPassword) && !confirm('Close and clear the temporary passwords? Download credentials before closing if needed.'))return;reset();dialog.close();returnFocus?.focus();}
el('openStudentImportButton').addEventListener('click',async()=>{if(globalThis.USC_AUTH_READY && !await globalThis.USC_AUTH_READY)return;returnFocus=document.activeElement;reset();dialog.showModal();el('studentImportFile').focus();});
el('closeStudentImportButton').addEventListener('click',close);
dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
window.addEventListener('beforeunload',event=>{if(busy || rows.some(r=>r.temporaryPassword)){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{reset();dialog.close();});
function download(name,headers,data){const url=URL.createObjectURL(new Blob([csvContent(headers,data)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el('downloadStudentImportTemplate').addEventListener('click',()=>download('SSU_student_import_template.csv',IMPORT_FIELDS.map(([,label])=>label),[]));
for(const college of Object.keys(SSU_PROGRAMS))el('importDefaultCollege').add(new Option(college,college));
el('importDefaultCollege').addEventListener('change',()=>{el('importDefaultProgram').replaceChildren(new Option('No default',''));for(const program of SSU_PROGRAMS[el('importDefaultCollege').value]||[])el('importDefaultProgram').add(new Option(program,program));invalidatePreview();});
for(const id of ['importDefaultProgram','importDefaultYear'])el(id).addEventListener('change',invalidatePreview);
function invalidatePreview(){rows=[];resultsMode=false;el('importReview').hidden=true;el('confirmStudentImport').hidden=true;el('exportStudentImportReport').hidden=true;feedback('');}
async function parse(sheet){
  if(!file)return;const ticket=++generation;worker?.terminate();setBusy(true);feedback('Reading file…');el('importReview').hidden=true;el('confirmStudentImport').hidden=true;
  try {
    const bytes=await file.arrayBuffer();if(ticket!==generation)return;
    const parsed=await new Promise((resolve,reject)=>{worker=new Worker(new URL('./student-import-worker.js',import.meta.url));const timer=setTimeout(()=>{worker?.terminate();reject(Error('Reading took too long. Reduce the file size and try again.'));},20000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();worker=null;event.data.error?reject(Error(event.data.error)):resolve(event.data);};worker.onerror=()=>{clearTimeout(timer);worker?.terminate();worker=null;reject(Error('Unable to read this file. Try exporting it as CSV.'));};worker.postMessage({bytes,sheet},[bytes]);});
    if(ticket!==generation)return;matrix=parsed.matrix;rows=[];
    el('importSheet').replaceChildren(...parsed.names.map(name=>new Option(name,name)));el('importSheet').value=parsed.name;
    const headers=matrix[0]||[],mapping=detectColumns(headers);el('importMapping').replaceChildren();
    for(const [field,label] of IMPORT_FIELDS){const wrapper=document.createElement('label');wrapper.className='import-field';wrapper.append(document.createTextNode(label));const select=document.createElement('select');select.dataset.map=field;select.add(new Option('Choose column / use default',''));headers.forEach((h,i)=>select.add(new Option(`${i+1}. ${String(h||'Unnamed column')}`,String(i))));select.value=mapping[field];select.addEventListener('change',invalidatePreview);wrapper.append(select);el('importMapping').append(wrapper);}
    el('importMappingSection').hidden=false;feedback(`${Math.max(0,matrix.length-1)} rows detected. Review column matches, then preview.`);
  }catch(error){matrix=[];el('importMappingSection').hidden=true;feedback(error.message,true);}finally{if(ticket===generation)setBusy(false);}
}
async function loadFile(selected){if(busy || !selected)return;if(!/\.(xlsx|xls|csv)$/i.test(selected.name)||selected.size>5*1024*1024||!selected.size){matrix=[];rows=[];el('importMappingSection').hidden=true;el('importReview').hidden=true;el('confirmStudentImport').hidden=true;setBusy(false);feedback('Choose a nonempty XLSX, XLS or CSV file up to 5 MB.',true);return;}file=selected;await parse();}
el('studentImportFile').addEventListener('change',event=>loadFile(event.target.files[0]));
el('importSheet').addEventListener('change',()=>parse(el('importSheet').value));
const dropzone=el('importDropzone');for(const type of ['dragover','dragleave','drop'])dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.toggle('is-over',type==='dragover');if(type==='drop'){if(event.dataTransfer.files.length!==1){feedback('Drop one file at a time.',true);return;}el('studentImportFile').files=event.dataTransfer.files;loadFile(event.dataTransfer.files[0]);}});
function render(){
  const counts=importSummary(rows);el('importSummary').replaceChildren();
  const metrics=resultsMode ? [['Total',counts.total],['Created',counts.created||0],['Skipped duplicates',(counts.duplicate||0)+(counts.existing||0)],['Invalid',counts.invalid||0],['Failed',counts.failed||0]] : [['Total',counts.total],['Valid',rows.filter(r=>r.valid).length],['Duplicates in file',counts.duplicate||0],['Existing accounts',counts.existing||0],['Invalid',counts.invalid||0],['Eligible',counts.ready||0]];
  if(counts.unconfirmed)metrics.push(['Unconfirmed',counts.unconfirmed]);
  for(const [label,count] of metrics){const span=document.createElement('span');span.className='import-stat';const strong=document.createElement('strong');strong.textContent=String(count);span.append(strong,document.createTextNode(label));el('importSummary').append(span);}
  const headers=['Row','Student','Student ID','Email','Program / year','Status','Details',...(resultsMode?['Temporary password']:[])];
  const tr=document.createElement('tr');for(const title of headers){const th=document.createElement('th');th.scope='col';th.textContent=title;tr.append(th);}el('importTableHead').replaceChildren(tr);
  el('importTableBody').replaceChildren(...rows.map(row=>{const tr=document.createElement('tr');for(const value of [row.sourceRow,row.fullName,row.studentId,row.institutionalEmail,`${row.program} · ${row.yearLevel}`,statuses[row.status]||row.status,row.message,...(resultsMode?[row.temporaryPassword||'—']:[])]){const td=document.createElement('td');td.textContent=String(value??'');tr.append(td);}const badge=document.createElement('span');badge.className=`import-status ${row.status}`;badge.textContent=statuses[row.status]||row.status;tr.children[5].replaceChildren(badge);return tr;}));
  el('importReview').hidden=false;
  if(rows.some(row=>row.temporaryPassword)){el('importCredentialWarning').hidden=false;el('exportStudentCredentials').hidden=false;}
}
async function call(name,batch){try{return (await httpsCallable(functions,name)({rows:batch.map(row=>Object.fromEntries(IMPORT_FIELDS.map(([key])=>[key,row[key]])))})).data;}catch(error){if(['functions/internal','functions/not-found','functions/unavailable'].includes(error?.code))throw Error('The import service could not be reached. A maintainer must verify the Firebase import functions deployment.');throw Error(error?.message||'The import request failed.');}}
el('previewStudentImport').addEventListener('click',async()=>{
  if(busy)return;try{const mapping=Object.fromEntries([...dialog.querySelectorAll('[data-map]')].map(e=>[e.dataset.map,e.value]));rows=mapRows(matrix,mapping,{college:el('importDefaultCollege').value,program:el('importDefaultProgram').value,yearLevel:el('importDefaultYear').value});}catch(error){feedback(error.message,true);return;}
  setBusy(true);const ticket=generation;el('studentImportProgress').hidden=false;el('studentImportProgress').value=0;feedback('Checking existing accounts…');
  try{for(let start=0;start<rows.length;start+=25){const batch=rows.slice(start,start+25),response=await call('previewStudentAccountImport',batch);if(ticket!==generation)return;if(!Array.isArray(response.results)||response.results.length!==batch.length)throw Error('Incomplete preview response. Run the preview again.');response.results.forEach((result,index)=>{const existing=batch[index];if(result.index!==index)throw Error('Invalid preview response.');rows[start+index]={...existing,...result.row,status:existing.status==='duplicate' && result.status!=='invalid'?'duplicate':result.status,message:existing.status==='duplicate' && result.status!=='invalid'?existing.message:result.message,valid:result.status!=='invalid'};});el('studentImportProgress').value=Math.round(Math.min(start+25,rows.length)/rows.length*100);}
    render();const eligible=rows.filter(r=>r.status==='ready').length;el('confirmStudentImport').hidden=!eligible;el('confirmStudentImport').textContent=`Create ${eligible} student account${eligible===1?'':'s'}`;el('exportStudentImportReport').hidden=false;feedback(eligible?'Preview complete. Review the records before creating accounts.':'No eligible accounts. Correct invalid rows or choose another file.');
  }catch(error){rows.forEach(row=>{if(row.status==='ready'||row.status==='unchecked')row.status='unconfirmed';});render();el('confirmStudentImport').hidden=true;feedback(error.message,true);}finally{if(ticket===generation){setBusy(false);el('studentImportProgress').hidden=true;}}
});
el('confirmStudentImport').addEventListener('click',async()=>{
  if(busy)return;const eligible=rows.filter(row=>row.status==='ready');if(!eligible.length)return;
  if(!confirm(`Create ${eligible.length} student accounts? Existing accounts will be skipped. Temporary passwords will be shown once.`))return;
  setBusy(true);const ticket=generation;resultsMode=true;el('importSetup').hidden=true;el('previewStudentImport').hidden=true;el('confirmStudentImport').hidden=true;el('studentImportProgress').hidden=false;el('studentImportProgress').value=0;feedback('Creating accounts… Keep this page open.');
  let stopped=false;
  for(let start=0;start<eligible.length;start+=25){const batch=eligible.slice(start,start+25);try{const response=await call('importStudentAccounts',batch);if(ticket!==generation)return;if(!Array.isArray(response.results)||response.results.length!==batch.length)throw Error('Incomplete import response.');response.results.forEach((result,index)=>{if(result.index!==index)throw Error('Invalid import response.');Object.assign(batch[index],{status:result.status,message:result.message,uid:result.uid,...(result.status==='created'&&typeof result.temporaryPassword==='string'?{temporaryPassword:result.temporaryPassword}:{})});});}catch(error){for(const row of batch)if(row.status==='ready')Object.assign(row,{status:'unconfirmed',message:'Response not confirmed. Re-preview before retrying; created accounts will be skipped.'});feedback(`${error.message} Some outcomes could not be confirmed.`,true);stopped=true;break;}render();el('studentImportProgress').value=Math.round(Math.min(start+25,eligible.length)/eligible.length*100);}
  for(const row of eligible)if(row.status==='ready')Object.assign(row,{status:'failed',message:'Not attempted because the import stopped.'});
  render();const created=rows.filter(r=>r.status==='created').length;el('exportStudentCredentials').hidden=!created;el('importCredentialWarning').hidden=!created;el('exportStudentImportReport').hidden=false;el('restartStudentImport').hidden=false;setBusy(false);el('studentImportProgress').hidden=true;if(!stopped)feedback(`Import complete: ${created} account${created===1?'':'s'} created.`);
});
el('exportStudentCredentials').addEventListener('click',()=>download('SSU_student_credentials.csv',['Student name','Student ID','Email','Temporary password','Status'],rows.filter(r=>r.status==='created'&&r.temporaryPassword).map(r=>[r.fullName,r.studentId,r.institutionalEmail,r.temporaryPassword,'Created'])));
el('exportStudentImportReport').addEventListener('click',()=>download('SSU_student_import_report.csv',['Source row','Student name','Student ID','Email','Status','Message'],rows.map(r=>[r.sourceRow,r.fullName,r.studentId,r.institutionalEmail,statuses[r.status],r.message])));
el('restartStudentImport').addEventListener('click',()=>{if(!rows.some(r=>r.temporaryPassword)||confirm('Clear temporary passwords and start another import?'))reset();});
reset();

onAuthStateChanged(auth,async user=>{if(!user){reset();dialog.close();return;}try{const token=await user.getIdTokenResult();if(token.claims.role!=='admin'){reset();dialog.close();}}catch{reset();dialog.close();}});
