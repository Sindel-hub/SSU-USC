import { mountAnnouncementGallery, linkAnnouncementText } from '../../../shared/announcement-media.mjs';
import { activityAttributionText } from '../../../shared/officer-activity-client.js';
import { hostedManagementCall as call } from '../../../shared/hosted-management-client.js';
import { attachSurveyButton } from '../../../shared/survey-links.mjs';
import { auth } from '../../../firebase/firebase-config.js';
import { facebookRequest } from './facebook-publishing.js';
let editing = null, editCallback, items = [], caps = {}, next = null;
const $ = id => document.getElementById(id);
const labels = { draft:'Draft', 'in-review':'In review', 'needs-revision':'Needs revision', ready:'Ready to publish', published:'Published' };
function el(tag, text, className) { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
export function clearReviewDraft() { editing=null; $('editingAnnouncementDraft').textContent=''; }
export async function draftImage(file) {
  if(!file)return editing?.content.imageUrl || '';
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPEG, PNG, or WebP image up to 5 MB.');
  const bitmap=await createImageBitmap(file), canvas=document.createElement('canvas');
  const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const image=canvas.toDataURL('image/webp',0.75);if(image.length>400000)throw new Error('This image is too detailed. Choose a smaller image.');return image;
}
export async function saveReviewDraft(input, submit) {
  const payload = { action: 'save', draftId: editing?.id || crypto.randomUUID(), expectedVersion: editing?.version || 0, input };
  let result;
  try { result = await call('announcementWorkflow', payload); }
  catch (error) {
    if (error.code && error.code !== 'unavailable') throw error;
    result = await call('announcementWorkflow', payload);
  }
  editing={id:result.id,version:result.version,content:input};
  if(submit)await call('announcementWorkflow',{action:'submit',draftId:result.id,expectedVersion:result.version});
  await refreshReviewDrafts();
}
async function act(row, action, note, button) {
  button.disabled=true;
  try {
    if(action==='edit'){$('announcementReviewDialog').close();await editCallback({...row.content,_draftId:row.id});editing=row;$('editingAnnouncementDraft').textContent=`Editing: ${row.content.title}`;return;}
    if(action==='publish'&&!confirm(`Publish the reviewed version of “${row.content.title}”?`))return;
    const result=await call('announcementWorkflow',{action,draftId:row.id,expectedVersion:row.version,note:note.value});
    if(action==='publish'&&result.facebookRequested){try{const f=await facebookRequest('publish',{announcementId:result.id});if(f.delivery?.status!=='succeeded')$('announcementReviewMessage').textContent='Bulletin Board published. Check Facebook delivery in the published post.';}catch(e){$('announcementReviewMessage').textContent='Bulletin Board published. Facebook delivery needs attention: '+e.message;}}
    await refreshReviewDrafts();
    if(action!=='publish'||!result.facebookRequested)$('announcementReviewMessage').textContent=action==='ready'?'Content review complete. The post is ready to publish.':action==='revise'?'Revision requested. The author can update and resubmit.':action==='submit'?'Draft submitted for content review.':'Announcement published.';
  }catch(e){$('announcementReviewMessage').textContent=e.message;}finally{button.disabled=false;}
}
function render() {
  const list=$('announcementReviewList'), expanded=new Set([...list.querySelectorAll('article[data-draft-id]')].filter(card=>card.querySelector('details')?.open).map(card=>card.dataset.draftId));list.replaceChildren();
  if (!items.length && !next) list.append(el('p', 'No drafts in the review queue.', 'review-muted'));
  for(const row of items){
    const card=el('article',undefined,'announcement-review-item'),head=el('div',undefined,'announcement-review-heading');
    card.dataset.draftId=row.id; card.dataset.status=row.status;
    const heading=el('div',undefined,'review-title-group'); const icon=el('span',undefined,'review-draft-icon'); icon.setAttribute('aria-hidden','true'); icon.innerHTML='<i class="fa-regular fa-file-lines"></i>'; heading.append(icon,el('h4',row.content.title)); head.append(heading,el('span',labels[row.status]||row.status,'review-status'));
    const meta=el('div',undefined,'review-meta'); meta.append(el('span',row.content.category,'review-meta-chip'),el('span',row.content.audience,'review-meta-chip')); card.append(head,meta);
    const attribution = activityAttributionText(row.activityAttribution);
    card.append(el('p', attribution || `Author: ${row.authorUid}`, 'review-muted review-attribution'));
    const preview=el('details',undefined,'review-disclosure'),summary=el('summary'); const summaryText=el('span','Read full draft'); summary.append(summaryText); preview.addEventListener('toggle',()=>summaryText.textContent=preview.open?'Hide full draft':'Read full draft');
    preview.open=expanded.has(row.id);
    const body = el('p', row.content.content, 'review-content'); const full=el('div',undefined,'review-full-body');
    full.append(body); preview.append(summary, full);
    card.append(el('p',row.content.content.length>180?row.content.content.slice(0,180)+'…':row.content.content,'review-content review-excerpt'));
    const gallery=el('div');full.append(gallery);
    if(row.content.imageIds?.length) Promise.all(row.content.imageIds.map(id=>loadReviewImage(row.id,id))).then(imageUrls=>mountAnnouncementGallery(gallery,{...row.content,imageUrls})).catch(error=>{$('announcementReviewMessage').textContent=error.message;});
    else mountAnnouncementGallery(gallery,row.content);
    linkAnnouncementText(body);
    card.append(el('p', `Submitted: ${new Date(row.submittedAtMs || row.createdAtMs).toLocaleString()}`, 'review-muted review-timestamp'));
    attachSurveyButton(body, row.content);
    if (row.content.facebookRequested) full.append(el('p', 'Also publish to Facebook', 'review-channel'));
    card.append(preview);
    if(row.reviewNote)card.append(el('p','Reviewer note: '+row.reviewNote,'review-note'));
    const note=el('textarea');note.placeholder='Review notes (required when requesting revision)';note.maxLength=2000;note.setAttribute('aria-label',`Review note for ${row.content.title}`);
    const actions=el('div',undefined,'review-actions');
    function add(label,action){const b=el('button',label,'mini-btn light');b.type='button';b.dataset.reviewAction=action;b.onclick=()=>act(row,action,note,b);actions.append(b);}
    if(caps.draft&&row.authorUid===auth.currentUser?.uid&&['draft','needs-revision','ready'].includes(row.status))add('Edit draft','edit');
    if(caps.draft&&row.authorUid===auth.currentUser?.uid&&['draft','needs-revision'].includes(row.status))add('Send for review','submit');
    const ownDraft = row.authorUid === auth.currentUser?.uid;
    if (caps.review && (!ownDraft || caps.approveOwn) && row.status === 'in-review') {
      if (!ownDraft) { const noteBox=el('div',undefined,'review-note-field');const label=el('label','Reviewer feedback');label.append(note);noteBox.append(label);card.append(noteBox); add('Needs revision', 'revise'); }
      add(ownDraft ? 'Approve for publication' : 'Ready to publish', 'ready');
      actions.querySelectorAll('button').forEach(b=>{const handler=b.onclick;b.onclick=()=>{if(!preview.open){preview.open=true;$('announcementReviewMessage').textContent='Read the complete draft and attachments before recording your review.';return;}handler();};});
    }
    if(caps.publish&&row.status==='ready')add('Publish reviewed post','publish');
    card.append(actions);list.append(card);
  }
  $('announcementReviewMore').hidden=!next;
}
export async function refreshReviewDrafts(more=false) {
  const result=await call('announcementDraftList',more?{after:next}:{});caps=result.capabilities;
  const badge=$('announcementReviewBadge');badge.textContent=String(result.pendingCount || 0);badge.hidden=!result.pendingCount;
  $('openAnnouncementReview').setAttribute('aria-label',`Review Announcements${result.pendingCount ? ', '+result.pendingCount+' pending' : ''}`);const drafts = result.items.filter(row => row.status !== 'published');
  items = more ? [...items, ...drafts] : drafts;
  next = result.next;
  render();
  $('announcementFormCard').hidden=!caps.draft;
}
export async function initializeAnnouncementReview(edit) {
  editCallback=edit;
  const dialog=$('announcementReviewDialog');
  $('openAnnouncementReview').onclick=()=>{dialog.showModal();document.documentElement.classList.add('announcement-review-open');refreshReviewDrafts().catch(e=>{$('announcementReviewMessage').textContent=e.message;});};
  $('closeAnnouncementReview').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>document.documentElement.classList.remove('announcement-review-open'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshReviewDrafts().catch(()=>{});});
  setInterval(()=>{if(!document.hidden)refreshReviewDrafts().catch(()=>{});},15000);
  $('announcementReviewRefresh').onclick=()=>refreshReviewDrafts().catch(e=>{$('announcementReviewMessage').textContent=e.message;});
  $('announcementReviewMore').onclick=()=>refreshReviewDrafts(true).catch(e=>{$('announcementReviewMessage').textContent=e.message;});
  try{await refreshReviewDrafts();}catch(e){$('announcementReviewMessage').textContent=e.message;$('announcementFormCard').hidden=true;}
}

export async function uploadReviewImage(imageUrl) { return call('announcementWorkflow',{action:'uploadImage',draftId:crypto.randomUUID(),input:{imageUrl}}); }
export async function loadReviewImage(draftId,imageId) { return (await call('announcementWorkflow',{action:'readImage',draftId,imageId})).imageUrl; }
