import { createClient } from 'npm:@supabase/supabase-js@2';
import { isAdministrator, canPublish, deliveryMessage } from './policy.mjs';

function secret(name: string) { const value = Deno.env.get(name); if (!value) throw new Error('Facebook service is not configured.'); return value; }
const db = createClient(secret('SUPABASE_URL'), secret('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false}});
const origin = new URL(secret('PORTAL_URL')).origin;
const redirect = secret('FACEBOOK_REDIRECT_URI');
const version = secret('FACEBOOK_GRAPH_VERSION');
if (!/^v\d+\.\d+$/.test(version) || new URL(redirect).origin !== origin) throw new Error('Invalid Facebook service configuration');
const cors = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,x-firebase-token','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
function reply(data: unknown, status=200) { return new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}}); }
function check(error: unknown) { if (error) throw new Error('Facebook storage is unavailable. Please try again later.'); }
const bytes = (value: string) => new TextEncoder().encode(value);
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(value))),b=>b.toString(16).padStart(2,'0')).join(''); }
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
async function encryptionKey() { return crypto.subtle.importKey('raw',Uint8Array.from(atob(secret('FACEBOOK_TOKEN_KEY')),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']); }
async function seal(value: unknown) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(),bytes(JSON.stringify(value)));
  return base64(iv)+'.'+base64(new Uint8Array(data));
}
async function unseal(value: string) {
  const [iv,data]=value.split('.').map(part=>Uint8Array.from(atob(part),c=>c.charCodeAt(0)));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},await encryptionKey(),data)));
}
function unpack(value: any): any {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('arrayValue' in value) return (value.arrayValue.values||[]).map(unpack);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,unpack(v)]));
  if ('integerValue' in value) return Number(value.integerValue);
  return null;
}
async function firestore(path: string, token: string) {
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${secret('FIREBASE_PROJECT_ID')}/databases/(default)/documents/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('Unable to read the authorized portal record.');
  const data=await response.json(); return unpack({mapValue:{fields:data.fields}});
}
async function session(req: Request) {
  const token=req.headers.get('x-firebase-token')||'';
  if (!token) throw new Error('Sign in again to continue.');
  // Google validates the ID token and returns current account state/custom claims.
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${secret('FIREBASE_WEB_API_KEY')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(12000)});
  const account=(await response.json()).users?.[0];
  if (!response.ok || !account || account.disabled) throw new Error('Your session is invalid. Sign in again.');
  const profile=await firestore(`users/${encodeURIComponent(account.localId)}`,token);
  const claims=JSON.parse(account.customAttributes||'{}');
  if (!isAdministrator(profile,claims) && !(profile.role==='officer' && profile.accountStatus==='approved' && profile.isActive!==false && (!profile.studentStanding||profile.studentStanding==='active'))) throw new Error('Officer or administrator access required.');
  return {uid:account.localId,token,profile,claims};
}
async function proof(token: string) {
  const key=await crypto.subtle.importKey('raw',bytes(secret('FACEBOOK_APP_SECRET')),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes(token))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function graph(path: string, params: Record<string,string>, token?: string, method='GET') {
  const url=new URL(`https://graph.facebook.com/${version}/${path}`);
  if(token) params={...params,appsecret_proof:await proof(token)};
  const form=new URLSearchParams(params);
  if(method==='GET') url.search=form.toString();
  const response=await fetch(url,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{})},body:method==='GET'?undefined:form,signal:AbortSignal.timeout(25000)});
  const data=await response.json();
  if(!response.ok||data.error) {
    // Do not leak token-bearing URLs or provider diagnostics to clients/logs.
    const error:any=new Error(data.error?.code===190?'Facebook authorization expired. Ask an administrator to reconnect the Page.':'Facebook rejected this request. Check Page permissions and try again.');
    error.definite=response.status<500 && Boolean(data.error); throw error;
  }
  return data;
}
async function connection() { const {data,error}=await db.from('facebook_connection').select('*').eq('id',true).maybeSingle(); check(error); return data; }
async function delivery(id: string) { const {data,error}=await db.from('facebook_deliveries').select('announcement_id,status,post_id,error,updated_at').eq('announcement_id',id).maybeSingle(); check(error); return data; }
function publicDelivery(row: any) {
  if(row?.status==='sending' && Date.now()-Date.parse(row.updated_at)>90000) return {...row,status:'uncertain',error:'Facebook delivery could not be confirmed. Ask an administrator to check the Page before retrying.'};
  return row;
}
Deno.serve(async req=>{
  if(req.headers.get('origin') && req.headers.get('origin')!==origin) return reply({ok:false,message:'Origin not allowed'},403);
  if(req.method==='OPTIONS') return new Response(null,{headers:cors});
  if(req.method!=='POST') return reply({ok:false,message:'Method not allowed'},405);
  try {
    const user=await session(req); const body=await req.json(); const action=String(body.action||'');
    const admin=isAdministrator(user.profile,user.claims);
    if(action==='status') {
      const c=await connection(); return reply({ok:true,connected:!!c,pageName:c?.page_name||'',pageId:c?.page_id||'',canConnect:admin,canPublish:canPublish(user.profile,user.claims)});
    }
    if(['begin','complete','connect','disconnect','reconcile'].includes(action)&&!admin) return reply({ok:false,message:'Only an authorized administrator can manage the Facebook connection.'},403);
    if(action==='begin') {
      if(!/^[a-f0-9]{64}$/.test(body.verifier||'')) throw new Error('Invalid connection request.');
      const state=base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_');
      const {error}=await db.from('facebook_oauth_sessions').insert({state_hash:await hash(state),uid:user.uid,verifier_hash:await hash(body.verifier),expires_at:new Date(Date.now()+600000).toISOString()});check(error);
      // Expired OAuth credentials are never usable and are cleaned on connection attempts.
      await db.from('facebook_oauth_sessions').delete().lt('expires_at',new Date().toISOString());
      const url=new URL(`https://www.facebook.com/${version}/dialog/oauth`);
      url.search=new URLSearchParams({client_id:secret('FACEBOOK_APP_ID'),redirect_uri:redirect,response_type:'code',scope:'pages_show_list,pages_read_engagement,pages_manage_posts',state}).toString();
      return reply({ok:true,url:url.href});
    }
    if(action==='complete'||action==='connect') {
      const key=await hash(String(body.state||''));
      const {data:pending,error}=await db.from('facebook_oauth_sessions').select('*').eq('state_hash',key).eq('uid',user.uid).gt('expires_at',new Date().toISOString()).maybeSingle();check(error);
      if(!pending || pending.verifier_hash!==await hash(String(body.verifier||''))) throw new Error('Connection expired or invalid. Start again from Settings.');
      if(action==='complete') {
        const {data:claimed,error:e}=await db.from('facebook_oauth_sessions').update({phase:'exchanging'}).eq('state_hash',key).eq('phase','started').select();check(e);
        if(!claimed?.length) throw new Error('This connection request has already been used.');
        const short=await graph('oauth/access_token',{client_id:secret('FACEBOOK_APP_ID'),client_secret:secret('FACEBOOK_APP_SECRET'),redirect_uri:redirect,code:String(body.code||'')});
        const long=await graph('oauth/access_token',{grant_type:'fb_exchange_token',client_id:secret('FACEBOOK_APP_ID'),client_secret:secret('FACEBOOK_APP_SECRET'),fb_exchange_token:short.access_token});
        const pages:any[]=[]; let after='';
        do {
          const result=await graph('me/accounts',{fields:'id,name,access_token,tasks',limit:'100',...(after?{after}:{})},long.access_token);
          pages.push(...(result.data||[]).filter((page:any)=>page.access_token&&page.tasks?.includes('CREATE_CONTENT')));
          after=result.paging?.next?result.paging?.cursors?.after||'':'';
        } while(after&&pages.length<1000);
        if(!pages.length) throw new Error('No publishable Page found. Grant the requested permissions and Page access, then reconnect.');
        const {error:save}=await db.from('facebook_oauth_sessions').update({phase:'selecting',pages_cipher:await seal(pages)}).eq('state_hash',key);check(save);
        return reply({ok:true,pages:pages.map(({id,name})=>({id,name}))});
      }
      const pages=await unseal(pending.pages_cipher||''); const page=pages.find((p:any)=>p.id===body.pageId);
      if(!page||pending.phase!=='selecting') throw new Error('Select an authorized Facebook Page.');
      const {data:consumed,error:e}=await db.from('facebook_oauth_sessions').delete().eq('state_hash',key).eq('phase','selecting').select('uid');check(e);
      if(!consumed?.length) throw new Error('This connection request has already been used.');
      const {error:save}=await db.from('facebook_connection').upsert({id:true,page_id:page.id,page_name:page.name,token_cipher:await seal(page.access_token),connected_by:user.uid,connected_at:new Date().toISOString()});check(save);
      return reply({ok:true,pageName:page.name});
    }
    if(action==='disconnect') { const {error}=await db.from('facebook_connection').delete().eq('id',true);check(error);return reply({ok:true}); }
    if(action==='deliveries') {
      const ids=Array.isArray(body.ids)?body.ids.filter((id:unknown)=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id)).slice(0,100):[];
      if(!ids.length)return reply({ok:true,deliveries:[]});
      const {data,error}=await db.from('facebook_deliveries').select('announcement_id,status,post_id,error,updated_at').in('announcement_id',ids);check(error);
      return reply({ok:true,deliveries:(data||[]).map(publicDelivery)});
    }
    const id=String(body.announcementId||'');
    if(!/^[\w-]{1,128}$/.test(id)) throw new Error('Invalid announcement.');
    if(action==='reconcile') {
      const c=await connection(); if(!c)throw new Error('Connect the Page first.');
      const postId=String(body.postId||''); if(!/^\d+_\d+$/.test(postId)||!postId.startsWith(c.page_id+'_'))throw new Error('Enter a post ID from the connected Page.');
      const {data:row,error}=await db.from('facebook_deliveries').select('*').eq('announcement_id',id).single();check(error);
      if(!row||!['sending','uncertain'].includes(row.status)||row.page_id!==c.page_id)throw new Error('This delivery does not need reconciliation.');
      const post=await graph(postId,{fields:'id,message'},await unseal(c.token_cipher));
      if(post.message!==row.message)throw new Error('The Facebook post does not match this announcement.');
      const {error:save}=await db.from('facebook_deliveries').update({status:'succeeded',post_id:post.id,error:null,updated_at:new Date().toISOString()}).eq('announcement_id',id).in('status',['sending','uncertain']);check(save);
      return reply({ok:true,delivery:await delivery(id)});
    }
    if(action!=='publish')throw new Error('Unknown Facebook action.');
    if(!canPublish(user.profile,user.claims))return reply({ok:false,message:'Bulletin management permission required.'},403);
    const post=await firestore(`announcements/${id}`,user.token);
    if(post.facebookRequested!==true)throw new Error('Facebook publishing was not enabled for this announcement.');
    const c=await connection(); if(!c)throw new Error('No Facebook Page connected. Connect one in Settings and retry.');
    const message=deliveryMessage(post);
    if(!message.trim()||message.length>60000)throw new Error('The announcement is too long for Facebook.');
    const image=String(post.imageUrl||'');
    if(image && !/^https:\/\//.test(image))throw new Error('Facebook requires a publicly accessible HTTPS image.');
    // Decrypt before taking the reservation, so configuration errors remain safely retryable.
    const token=await unseal(c.token_cipher);
    const {data:claimed,error}=await db.rpc('claim_facebook_delivery',{p_id:id,p_page:c.page_id,p_message:message,p_image:image||null});check(error);
    if(!claimed?.length) {
      const existing=await delivery(id);
      if(existing?.status==='failed') throw new Error('This announcement was attempted on a different Page. Reconnect the original Page to retry.');
      return reply({ok:true,delivery:publicDelivery(existing)});
    }
    const row=claimed[0];
    let result;
    try {
      result=await graph(`${c.page_id}/${row.image_url?'photos':'feed'}`,row.image_url?{url:row.image_url,caption:row.message,published:'true'}:{message:row.message},token,'POST');
    } catch(error:any) {
      const definite=error.definite===true;
      const message=definite?error.message:'Facebook delivery could not be confirmed. Ask an administrator to check the Page; another post has not been sent.';
      const {error:save}=await db.from('facebook_deliveries').update({status:definite?'failed':'uncertain',error:message,updated_at:new Date().toISOString()}).eq('announcement_id',id);check(save);
      return reply({ok:true,delivery:await delivery(id)});
    }
    const postId=result.post_id||result.id;
    const {error:save}=await db.from('facebook_deliveries').update({status:postId?'succeeded':'uncertain',post_id:postId||null,error:postId?null:'Facebook did not return a post ID.',updated_at:new Date().toISOString()}).eq('announcement_id',id);check(save);
    return reply({ok:true,delivery:await delivery(id)});
  } catch(error) {
    // Internal errors are intentionally not logged with OAuth credentials.
    return reply({ok:false,message:error instanceof Error?error.message:'Facebook request failed.'},400);
  }
});
