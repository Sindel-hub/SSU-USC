import { facebookRequest, openFacebookSettings } from '../../../shared/facebook-service.js';
export { facebookRequest };
let canConnect=false;
export function initializeFacebookPublishing(endCompose) {
  const toggle=document.getElementById('alsoPostFacebook');
  const hint=document.getElementById('facebookConnectionHint');
  async function refresh() {
    try {
      const state=await facebookRequest('status');canConnect=state.canConnect;
      toggle.disabled=!state.connected || !state.canPublish;
      if(!state.connected)toggle.checked=false;
      hint.textContent=state.connected?'Connected to '+state.pageName:'No Page connected. An administrator can connect one in Settings.';
    }catch(error){toggle.disabled=true;toggle.checked=false;hint.textContent=error.message;}
  }
  document.getElementById('openFacebookConnection').addEventListener('click',()=>{endCompose();openFacebookSettings();});
  window.addEventListener('focus',refresh);refresh();
}
function showDelivery(host,row,id,allowRetry) {
  host.replaceChildren();const text=document.createElement('span');
  const state=row?.status||'not-started';
  text.textContent=({succeeded:'Published to Facebook.',sending:'Facebook publishing is in progress.',failed:'Facebook publishing failed.',uncertain:'Facebook delivery needs review.','not-started':'Facebook publishing has not completed.'})[state];
  if(row?.error)text.textContent+=' '+row.error;host.append(text);
  if(state==='succeeded'&&/^[0-9_]+$/.test(row.post_id||'')) {
    const link=document.createElement('a');link.textContent='View on Facebook';link.href='https://www.facebook.com/'+row.post_id;link.target='_blank';link.rel='noopener noreferrer';host.append(link);
  }
  if(allowRetry&&['failed','not-started'].includes(state)) {
    const retry=document.createElement('button');retry.type='button';retry.className='mini-btn light';retry.textContent='Retry Facebook';retry.dataset.rbacPermission='bulletin.manage';
    retry.addEventListener('click',async event=>{
      event.stopPropagation();retry.disabled=true;text.textContent='Sending to Facebook…';
      try{const result=await facebookRequest('publish',{announcementId:id});showDelivery(host,result.delivery,id,true);}
      catch(error){text.textContent='Bulletin Board post is saved. '+error.message;retry.disabled=false;}
    });host.append(retry);
  }
  if(canConnect&&state==='uncertain') {
    const button=document.createElement('button');button.type='button';button.className='mini-btn light';button.textContent='Confirm existing Facebook post';
    button.addEventListener('click',async event=>{
      event.stopPropagation();const postId=prompt('After checking the official Page, enter the matching Facebook post ID (PAGE_ID_POST_ID).');if(!postId)return;
      button.disabled=true;
      try{const result=await facebookRequest('reconcile',{announcementId:id,postId:postId.trim()});showDelivery(host,result.delivery,id,true);}
      catch(error){text.textContent=error.message;button.disabled=false;}
    });host.append(button);
  }
}
export async function hydrateFacebookDeliveries(list,view) {
  const hosts=[...list.querySelectorAll('[data-facebook-delivery]')];if(!hosts.length)return;
  try {
    for(let offset=0;offset<hosts.length;offset+=100){
      const batch=hosts.slice(offset,offset+100);
      const result=await facebookRequest('deliveries',{ids:batch.map(host=>host.dataset.facebookDelivery)});
      const rows=new Map(result.deliveries.map(row=>[row.announcement_id,row]));
      batch.forEach(host=>{if(host.isConnected)showDelivery(host,rows.get(host.dataset.facebookDelivery),host.dataset.facebookDelivery,view==='published');});
    }
  }catch(error){hosts.forEach(host=>{if(host.isConnected){showDelivery(host,null,host.dataset.facebookDelivery,view==='published');host.querySelector('span').textContent='Facebook status unavailable. '+error.message;}});}
}
