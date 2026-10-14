import { auth } from '../firebase/firebase-config.js';
import { facebookRequest } from './facebook-service.js';
const params=new URLSearchParams(location.search);
history.replaceState(null,'',location.pathname);
const label=document.getElementById('facebookCallbackStatus');
const selection=document.getElementById('facebookPageSelection');
try {
  const saved=JSON.parse(sessionStorage.getItem('uscFacebookOAuth')||'null');
  if(!saved || params.get('state')!==saved.state)throw new Error('Connection expired. Start again from Settings.');
  const returnUrl=new URL(saved.returnUrl,location.origin);
  if(returnUrl.origin===location.origin)document.getElementById('facebookReturn').href=returnUrl.href;
  if(params.has('error')){sessionStorage.removeItem('uscFacebookOAuth');throw new Error('Facebook connection was cancelled. No Page was connected.');}
  await auth.authStateReady();
  const result=await facebookRequest('complete',{code:params.get('code'),state:saved.state,verifier:saved.verifier});
  label.textContent='Choose the official Facebook Page for Bulletin Board announcements.';
  const select=document.createElement('select');select.setAttribute('aria-label','Official Facebook Page');
  for(const page of result.pages){const option=document.createElement('option');option.value=page.id;option.textContent=page.name;select.append(option);}
  const button=document.createElement('button');button.textContent='Connect selected Page';button.type='button';
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{const connection=await facebookRequest('connect',{state:saved.state,verifier:saved.verifier,pageId:select.value});sessionStorage.removeItem('uscFacebookOAuth');selection.replaceChildren();label.textContent=`Connected to ${connection.pageName}. You can now optionally publish announcements to Facebook.`;}
    catch(error){label.textContent=error.message;button.disabled=false;}
  });selection.append(select,button);
}catch(error){label.textContent=error.message;}
