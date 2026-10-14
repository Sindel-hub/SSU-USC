import { auth } from '../firebase/firebase-config.js';

export async function facebookRequest(action, payload = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in again to continue.');
  const url = globalThis.USC_FACEBOOK_FUNCTION_URL;
  if (!url || !/^https:\/\//.test(url)) throw new Error('Facebook connection is not configured yet. Contact your administrator.');
  const response = await fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json','x-firebase-token':await user.getIdToken()},
    body:JSON.stringify({action,...payload}), credentials:'omit', signal:AbortSignal.timeout(60000)
  });
  const data=await response.json();
  if(!response.ok||data.ok===false)throw new Error(data.message||'Facebook service unavailable. Try again later.');
  return data;
}
export function openFacebookSettings() {
  document.getElementById('uscSettingsTrigger')?.click();
  document.getElementById('facebookConnectionSettings')?.scrollIntoView({block:'nearest'});
}
export async function mountFacebookSettings(container, role) {
  if(!container || !['admin','officer'].includes(role))return;
  container.hidden=false;
  container.innerHTML='<strong>Facebook Connection</strong><p data-facebook-state role="status">Checking connection…</p><div data-facebook-actions></div>';
  const label=container.querySelector('[data-facebook-state]');
  const actions=container.querySelector('[data-facebook-actions]');
  function button(text, handler) {
    const element=document.createElement('button');element.type='button';element.className='usc-settings-secondary-btn';element.textContent=text;
    element.addEventListener('click',async()=>{element.disabled=true;try{await handler();}catch(error){label.textContent=error.message;}finally{element.disabled=false;}});
    actions.append(element);
  }
  try {
    const state=await facebookRequest('status');
    label.textContent=state.connected?`Connected to ${state.pageName}`:'No Facebook Page connected.';
    if(!state.canConnect){if(!state.connected)label.textContent+=' Ask an administrator to connect the official Page here.';return;}
    button(state.connected?'Reconnect Facebook Page':'Connect Facebook Page',async()=>{
      const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      const result=await facebookRequest('begin',{verifier});
      const url=new URL(result.url);
      if(url.origin!=='https://www.facebook.com')throw new Error('Invalid Facebook authorization URL.');
      sessionStorage.setItem('uscFacebookOAuth',JSON.stringify({verifier,state:url.searchParams.get('state'),returnUrl:location.href}));
      location.assign(url.href);
    });
    if(state.connected)button('Disconnect',async()=>{
      if(!confirm('Disconnect the official Facebook Page? Bulletin Board posts will remain unchanged.'))return;
      await facebookRequest('disconnect');await mountFacebookSettings(container,role);
    });
  } catch(error) { label.textContent=error.message;button('Check connection again',()=>mountFacebookSettings(container,role)); }
}
