import { activityAttributionText } from '../../../shared/officer-activity-client.js';
import { hostedManagementCall as call } from '../../../shared/hosted-management-client.js';
import { auth } from '../../../firebase/firebase-config.js';
import { facebookRequest } from './facebook-publishing.js';
let editing = null, editCallback, items = [], caps = {}, next = null;
const $ = id => document.getElementById(id);
const labels = { draft:'Draft', 'in-review':'In review', 'needs-revision':'Needs revision', ready:'Ready to publish', published:'Published' };
function el(tag, text, className) { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; }
export function clearReviewDraft() { editing=null; $('editingAnnouncementDraft').textContent='New draft'; }
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
    if(action==='edit'){editCallback(row.content);editing=row;$('editingAnnouncementDraft').textContent=`Editing: ${row.content.title}`;return;}
    if(action==='publish'&&!confirm(`Publish the reviewed version of “${row.content.title}”?`))return;
    const result=await call('announcementWorkflow',{action,draftId:row.id,expectedVersion:row.version,note:note.value});
    if(action==='publish'&&result.facebookRequested){try{const f=await facebookRequest('publish',{announcementId:result.id});if(f.delivery?.status!=='succeeded')$('announcementReviewMessage').textContent='Bulletin Board published. Check Facebook delivery in the published post.';}catch(e){$('announcementReviewMessage').textContent='Bulletin Board published. Facebook delivery needs attention: '+e.message;}}
    await refreshReviewDrafts();
    if(action!=='publish'||!result.facebookRequested)$('announcementReviewMessage').textContent=action==='ready'?'Content review complete. The post is ready to publish.':action==='revise'?'Revision requested. The author can update and resubmit.':action==='submit'?'Draft submitted for content review.':'Announcement published.';
  }catch(e){$('announcementReviewMessage').textContent=e.message;}finally{button.disabled=false;}
}
function render() {
  const list=$('announcementReviewList');list.replaceChildren();
  if(!items.length)list.append(el('p','No announcement drafts yet. Save a draft to start the review process.','review-muted'));
  for(const row of items){
    const card=el('article',undefined,'announcement-review-item'),head=el('div',undefined,'announcement-review-heading');
    head.append(el('h4',row.content.title),el('span',labels[row.status]||row.status,'review-status'));
    card.append(head,el('p',`${row.content.category} · ${row.content.audience} · Version ${row.version}`,'review-muted'));
    const attribution = activityAttributionText(row.activityAttribution);
    if (attribution) card.append(el('p', attribution, 'review-muted'));
    const preview=el('details'),summary=el('summary','Read full draft');preview.append(summary,el('p',row.content.content,'review-content'));
    if(row.content.imageUrl){const img=el('img');img.src=row.content.imageUrl;img.alt='Draft announcement image';preview.append(img);}
    if(row.content.surveyId)preview.append(el('p',`Attached survey: ${row.content.surveyId}`));
    preview.append(el('p',row.content.facebookRequested?'Publish destinations: Bulletin Board and Facebook':'Publish destination: Bulletin Board','review-muted'));card.append(preview);
    if(row.reviewNote)card.append(el('p','Reviewer note: '+row.reviewNote,'review-note'));
    const note=el('textarea');note.placeholder='Review notes (required when requesting revision)';note.maxLength=2000;note.setAttribute('aria-label',`Review note for ${row.content.title}`);
    const actions=el('div',undefined,'review-actions');
    function add(label,action){const b=el('button',label,'mini-btn light');b.type='button';b.onclick=()=>act(row,action,note,b);actions.append(b);}
    if(caps.draft&&row.authorUid===auth.currentUser?.uid&&['draft','needs-revision','ready'].includes(row.status))add('Edit draft','edit');
    if(caps.draft&&row.authorUid===auth.currentUser?.uid&&['draft','needs-revision'].includes(row.status))add('Send for review','submit');
    if(caps.review&&row.authorUid!==auth.currentUser?.uid&&row.status==='in-review'){
      card.append(note);add('Needs revision','revise');add('Ready to publish','ready');
      actions.querySelectorAll('button').forEach(b=>{const handler=b.onclick;b.onclick=()=>{if(!preview.open){preview.open=true;$('announcementReviewMessage').textContent='Read the complete draft and attachments before recording your review.';return;}handler();};});
    }
    if(caps.publish&&row.status==='ready')add('Publish reviewed post','publish');
    card.append(actions);list.append(card);
  }
  $('announcementReviewMore').hidden=!next;
}
export async function refreshReviewDrafts(more=false) {
  const result=await call('announcementDraftList',more?{after:next}:{});caps=result.capabilities;items=more?[...items,...result.items]:result.items;next=result.next;render();
  $('announcementFormCard').hidden=!caps.draft;
}
export async function initializeAnnouncementReview(edit) {
  editCallback=edit;
  $('announcementReviewRefresh').onclick=()=>refreshReviewDrafts().catch(e=>{$('announcementReviewMessage').textContent=e.message;});
  $('announcementReviewMore').onclick=()=>refreshReviewDrafts(true).catch(e=>{$('announcementReviewMessage').textContent=e.message;});
  try{await refreshReviewDrafts();}catch(e){$('announcementReviewMessage').textContent=e.message;$('announcementFormCard').hidden=true;}
}
