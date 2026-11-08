import {callStudentEmailService} from "./supabase-email-service.js";
import { auth, db } from '../firebase/firebase-config.js';
import {collection,collectionGroup,query,where,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import {manageCandidateRegistration,registrationFields,historyElectionStatus} from './registration-history-store.js';
import {effectiveOfficerPermissions} from './officer-permissions.js';
import {openPrivateFile,hydrateMediaImages,refreshRegistrationReviewCompletion} from './security-client.js';
const ready=await(globalThis.USC_AUTH_READY||Promise.resolve(false));
if(ready===true&&auth.currentUser){
 const officer=location.pathname.includes('/usc-admin/');
 let profile={};try{profile=JSON.parse(sessionStorage.getItem('studentProfile')||'{}')}catch{}
 const canManage=officer&&(profile.role==='admin'||effectiveOfficerPermissions(profile).includes('elections.review'));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
 const ms=v=>v?.toMillis?.()||Number(v)||0,date=v=>ms(v)?new Date(ms(v)).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Not recorded';
 const root=document.createElement(officer?'section':'dialog');root.className='registration-history';root.setAttribute('aria-label','Candidate Registration History');
 root.innerHTML=`<header><h2>${officer?'Candidate Registration History':'My Candidate Registrations'}</h2>${officer?'':'<button data-close type="button">Close</button>'}</header><div class="registration-history-filters"><label>Search<input data-search type="search" placeholder="Name or Student ID"></label><label>Election<select data-election><option value="">All elections</option></select></label><label>Application status<select data-status><option value="">All statuses</option><option value="Under Review">Pending / Under Review</option><option>Approved</option><option>Rejected</option><option>Needs Information</option></select></label><label>Election status<select data-stage><option value="">All election statuses</option>${['Upcoming','Ongoing','Completed','Schedule Deleted','Archived'].map(s=>`<option>${s}</option>`).join('')}</select></label><label>Sort<select data-sort><option value="new">Newest first</option><option value="old">Oldest first</option></select></label></div><p data-message role="status" aria-live="polite"></p><button data-retry type="button" hidden>Retry loading history</button><p data-metadata-message role="status"></p><div data-rows></div>`;
 if(officer){const card=document.getElementById('candidateReviewCard')||document.getElementById('candidateReviewList');card?.after(root)}else{const button=document.createElement('button');button.type='button';button.textContent='My registrations';button.className='registration-history-open';document.querySelector('.student-module-toolbar h1')?.after(button);document.body.append(root);button.onclick=()=>root.showModal();root.querySelector('[data-close]').onclick=()=>root.close()}
 let records=[],elections=new Map(),electionFilterKey='',historyState='loading',delivery=new Map(),deliveryState='loading';
 const $=s=>root.querySelector(s),message=(text,error=false)=>{ $('[data-message]').textContent=text;$('[data-message]').classList.toggle('error',error)};
 const state=row=>({...row.electionSnapshot,...(elections.get(row.electionId)||{scheduleDeleted:true})});
 function render(){
  root.querySelectorAll('.registration-history-filters input,.registration-history-filters select').forEach(control=>{control.disabled=historyState!=='ready'});
  $('[data-retry]').hidden=historyState!=='error';
  $('[data-rows]').setAttribute('aria-busy',String(historyState==='loading'));
  if(historyState!=='ready'){ $('[data-rows]').replaceChildren(); return; }
  const available=[...new Set(records.filter(r=>!r.removed).map(r=>r.electionId))].sort(),key=available.join('|');
  if(key!==electionFilterKey){const selected=$('[data-election]').value;$('[data-election]').innerHTML='<option value="">All elections</option>'+available.map(id=>`<option value="${esc(id)}">${esc(elections.get(id)?.title||id)}</option>`).join('');$('[data-election]').value=available.includes(selected)?selected:'';electionFilterKey=key}
  const search=$('[data-search]').value.toLowerCase().trim(),election=$('[data-election]').value,status=$('[data-status]').value,stage=$('[data-stage]').value;
  const rows=records.filter(r=>!r.removed&&(!election||r.electionId===election)&&(!status||r.status===status||(status==='Under Review'&&r.status==='Pending'))&&(!stage||historyElectionStatus(state(r))===stage)&&(!search||`${r.fullName} ${r.studentId}`.toLowerCase().includes(search))).sort((a,b)=>($('[data-sort]').value==='old'?1:-1)*(ms(a.submittedAt)-ms(b.submittedAt)));
  $('[data-rows]').innerHTML=rows.length?rows.map(r=>`<article class="registration-history-row"><div><strong>${esc(r.fullName||r.studentId||r.id)}</strong><p>${esc(r.studentId)} · ${esc(r.position)}</p><p>${esc(state(r).title||'Election')} · ${esc(r.electionId)}</p><small>Registered: ${esc(date(r.submittedAt))}</small></div><div><span class="registration-history-badge">${esc(r.status||'Under Review')}</span><p>${esc(historyElectionStatus(state(r)))}</p>${r.notificationEventId?`<p class="registration-history-delivery">Email: ${esc(({queued:'Queued',sending:'Sending',sent:'Sent',failed:'Failed',unknown:'Delivery unconfirmed',cancelled:'Cancelled'})[delivery.get(r.notificationEventId)]||(deliveryState==='error'?'Unavailable':deliveryState==='ready'?'Not queued':'Checking delivery…'))}${canManage&&delivery.get(r.notificationEventId)==='failed'?` <button data-email-retry="${esc(r.notificationEventId)}" type="button">Retry email</button>`:''}</p>`:''}<button type="button" data-view="${esc(r.path)}">View details</button>${canManage?`<button type="button" data-edit="${esc(r.path)}">Edit</button><button type="button" data-delete="${esc(r.path)}">Delete candidate</button>`:''}</div></article>`).join(''):'<p class="registration-history-empty">No candidate registrations match these filters.</p>';
 }
 root.querySelectorAll('input,select').forEach(e=>e.addEventListener('input',render));
 root.addEventListener('click',async event=>{
  const retry=event.target.closest('button[data-email-retry]');
  if(retry){retry.disabled=true;try{await callStudentEmailService('candidate_notification_retry',{eventId:retry.dataset.emailRetry});message('Email queued for retry.')}catch(error){message(error.message,true)}finally{retry.disabled=false}return;}
  const button=event.target.closest('button[data-view],button[data-edit],button[data-delete]');if(!button)return;
  const path=button.dataset.view||button.dataset.edit||button.dataset.delete,row=records.find(r=>r.path===path);if(!row)return;
  if(button.dataset.delete){
   if(!confirm(`Delete candidate registration for ${row.fullName} (Student ID: ${row.studentId}) in ${state(row).title||row.electionId} [${row.electionId}]? This removes only this registration and its candidate publication. Ballots, results and other elections are preserved.`))return;
   button.disabled=true;try{await manageCandidateRegistration({electionId:row.electionId,registrationId:row.id,remove:true});message('Candidate registration deleted.');try{await refreshRegistrationReviewCompletion(row.electionId)}catch{message('Registration deleted; review summary could not refresh. Reload the election.',true)}}catch(e){message(e.message,true)}finally{button.disabled=false}return;
  }
  const edit=Boolean(button.dataset.edit),dialog=document.createElement('dialog');dialog.className='registration-history registration-history-details';
  dialog.setAttribute('aria-labelledby','registration-dialog-title');
  const labels={fullName:'Full name',position:'Position',department:'Department',program:'Program',college:'College',partylist:'Party / affiliation'};
  const field=key=>edit
   ? `<label class="registration-detail-field">${esc(labels[key])}<input name="${key}" maxlength="${registrationFields[key]}" value="${esc(row[key]||'')}" ${key==='fullName'||key==='position'?'required':''}></label>`
   : `<div class="registration-detail-field"><dt>${esc(labels[key])}</dt><dd>${esc(row[key]||'Not recorded')}</dd></div>`;
  const photo=row.campaignPhotoPath||row.campaignPhotoUrl;
  dialog.innerHTML=`<form class="registration-detail-form">
   <header class="registration-detail-header"><div><p class="registration-detail-eyebrow">${officer?'Election management':'Election registration'}</p><h2 id="registration-dialog-title">${edit?'Edit candidate registration':'Candidate registration'}</h2></div><button type="button" data-close aria-label="Close candidate registration">Close <span aria-hidden="true">×</span></button></header>
   <div class="registration-detail-body">
    <aside class="registration-detail-sidebar">
     <section class="registration-detail-identity">${photo?`<div class="registration-detail-photo-wrap"><img class="registration-history-photo" data-media-ref="${esc(photo)}" alt="Campaign photo of ${esc(row.fullName)}"></div>`:'<div class="registration-detail-avatar" aria-hidden="true">'+esc((row.fullName||'?').split(/\s+/).slice(0,2).map(n=>n[0]).join(''))+'</div>'}<h3>${esc(row.fullName||'Candidate')}</h3><p class="registration-detail-id">Student ID · ${esc(row.studentId||'Not recorded')}</p><span class="registration-history-badge">${esc(row.status||'Under Review')}</span></section>
     <section class="registration-detail-election"><h3>Election details</h3><p class="registration-detail-election-name">${esc(state(row).title||'Election')}</p><p class="registration-detail-election-id">${esc(row.electionId)}</p><dl><div><dt>Registration window</dt><dd>${esc(date(state(row).registrationStart))}<span>to ${esc(date(state(row).registrationEnd))}</span></dd></div><div><dt>Voting window</dt><dd>${esc(date(state(row).votingStart))}<span>to ${esc(date(state(row).votingEnd))}</span></dd></div><div><dt>Submitted</dt><dd>${esc(date(row.submittedAt))}</dd></div></dl></section>
    </aside>
    <div class="registration-detail-main">
     <section class="registration-detail-section"><h3>Candidate details</h3>${edit?'<div':'<dl'} class="registration-detail-grid">${Object.keys(labels).map(field).join('')}${edit?'</div>':'</dl>'}<dl class="registration-detail-contact"><div class="registration-detail-field"><dt>Email address</dt><dd>${esc(row.email||'Not recorded')}</dd></div></dl></section>
     <section class="registration-detail-section"><h3>Platform &amp; statement</h3>${edit?`<label class="registration-detail-field">Platform, advocacy and statement<textarea name="platform" maxlength="${registrationFields.platform}">${esc(row.platform||'')}</textarea></label>`:`<p class="registration-history-copy">${esc(row.platform||'Not recorded')}</p>`}</section>
     <section class="registration-detail-section"><h3>Supporting documents</h3><div class="registration-detail-documents" data-documents>${(row.supportingDocumentPaths||[]).length?'':'<p class="registration-detail-muted">No supporting documents recorded.</p>'}</div></section>
     <section class="registration-detail-section"><h3>Review note</h3><p class="registration-history-copy">${esc(row.reviewNote||'No review note recorded.')}</p></section>
     <p data-feedback role="status" aria-live="polite"></p>
    </div>
   </div>
   ${edit?'<footer class="registration-detail-footer"><span>Changes apply to this election registration.</span><button type="submit">Save registration</button></footer>':''}
  </form>`;
  document.body.append(dialog);dialog.showModal();hydrateMediaImages(dialog).catch(()=>{});dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  for(const [index,file] of (row.supportingDocumentPaths||[]).entries()){const open=document.createElement('button');open.type='button';open.textContent=`Supporting document ${index+1}`;open.onclick=async()=>{try{await openPrivateFile(file)}catch(e){dialog.querySelector('[data-feedback]').textContent=e.message}};dialog.querySelector('[data-documents]').append(open)}
  dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const save=dialog.querySelector('[type="submit"]');save.disabled=true;try{await manageCandidateRegistration({electionId:row.electionId,registrationId:row.id,details:Object.fromEntries(new FormData(event.target))});dialog.close();message('Candidate registration updated.');try{await refreshRegistrationReviewCompletion(row.electionId)}catch{message('Registration updated; review summary could not refresh. Reload the election.',true)}}catch(e){dialog.querySelector('[data-feedback]').textContent=e.message}finally{save.disabled=false}};
 });
 const source=officer?collectionGroup(db,'applications'):query(collectionGroup(db,'applications'),where('applicantUid','==',auth.currentUser.uid));
 let stopHistory=null,historyGeneration=0;
 function startHistory(){
  const generation=++historyGeneration;
  stopHistory?.();stopHistory=null;
  historyState='loading';records=[];message('Loading candidate registrations…');render();
  stopHistory=onSnapshot(source,snapshot=>{
   if(generation!==historyGeneration)return;
   records=snapshot.docs.filter(d=>/^elections\/[^/]+\/applications\/[^/]+$/.test(d.ref.path)).map(d=>({...d.data(),id:d.id,path:d.ref.path,electionId:d.ref.path.split('/')[1]}));
   historyState='ready';message('');render();
  },error=>{
   if(generation!==historyGeneration)return;
   historyState='error';records=[];
   const code=String(error?.code||'').replace(/^firestore\//,'');
   const explanation=code==='permission-denied'
    ? 'Your account cannot access registration history. Ask an administrator to verify your access and the published history security rules.'
    : code==='failed-precondition'
     ? 'The registration history database index is not ready. Ask an administrator to complete the history index setup.'
     : code==='unauthenticated'
      ? 'Your session has expired. Sign in again to view registration history.'
      : 'Registration history could not be loaded. Check your connection and try again.';
   message(explanation,true);render();
  });
 }
 $('[data-retry]').onclick=startHistory;
 const stopElections=onSnapshot(collection(db,'elections'),snapshot=>{
  elections=new Map(snapshot.docs.map(d=>[d.id,d.data()]));electionFilterKey='';
  $('[data-metadata-message]').textContent='';render();
 },()=>{ $('[data-metadata-message]').textContent='Election details could not be loaded; recorded details remain available.'; });
 const deliverySource=officer?collection(db,'candidate_email_events'):query(collection(db,'candidate_email_events'),where('uid','==',auth.currentUser.uid));
 const stopDelivery=onSnapshot(deliverySource,snapshot=>{delivery=new Map(snapshot.docs.map(d=>[d.id,d.data().state]));deliveryState='ready';render()},()=>{delivery=new Map();deliveryState='error';render()});
 startHistory();
 window.addEventListener('pagehide',event=>{if(!event.persisted){++historyGeneration;stopHistory?.();stopElections();stopDelivery()}});
}
