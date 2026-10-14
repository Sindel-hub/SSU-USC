import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { isAdministrator, canPublish, deliveryMessage, retryable } from '../supabase/functions/usc-facebook/policy.mjs';

const officer={role:'officer',isActive:true,accountStatus:'approved',studentStanding:'active',officePosition:'President'};
test('connection is admin-only and custom permission removal overrides office defaults',()=>{
  assert.equal(isAdministrator({...officer,role:'admin'},{}),false);
  assert.equal(isAdministrator({...officer,role:'admin'},{role:'admin'}),true);
  assert.equal(canPublish(officer,{}),true);
  assert.equal(canPublish({...officer,officerPermissionSource:'custom',officerPermissions:[]},{}),false);
  assert.equal(canPublish({...officer,isActive:false},{}),false);
  assert.equal(canPublish({...officer,studentStanding:'inactive'},{}),false);
  assert.equal(retryable('uncertain'),false);
});
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/usc-facebook/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''));
function wire(data) {
  return {fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,typeof value==='boolean'?{booleanValue:value}:Array.isArray(value)?{arrayValue:{values:value.map(v=>({stringValue:v}))}}:{stringValue:String(value)}]))};
}
async function harness({profile=officer,claims={},disabled=false,graphFailure=null}={}) {
  const tables={facebook_connection:[],facebook_deliveries:[],facebook_oauth_sessions:[]};
  let handler, graphCalls=0;
  class Query {
    constructor(name){this.name=name;this.filters=[];this.operation='read';}
    select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}
    in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
    gt(k,v){this.filters.push(r=>r[k]>v);return this;}
    lt(k,v){this.filters.push(r=>r[k]<v);return this;}
    update(value){this.operation='update';this.value=value;return this;}
    delete(){this.operation='delete';return this;}
    insert(value){tables[this.name].push({phase:"started",...value});return this;}
    upsert(value){tables[this.name]=[value];return this;}
    exec(single=false){
      const found=tables[this.name].filter(r=>this.filters.every(f=>f(r)));
      if(this.operation==='update')found.forEach(r=>Object.assign(r,this.value));
      if(this.operation==='delete')tables[this.name]=tables[this.name].filter(r=>!found.includes(r));
      return {data:single?found[0]||null:found,error:null};
    }
    maybeSingle(){return Promise.resolve(this.exec(true));}single(){return this.maybeSingle();}
    then(resolve,reject){return Promise.resolve(this.exec()).then(resolve,reject);}
  }
  const db={from:name=>new Query(name),rpc:async(_name,args)=>{
    let row=tables.facebook_deliveries.find(r=>r.announcement_id===args.p_id);
    if(row&&(row.status!=='failed'||row.page_id!==args.p_page))return {data:[],error:null};
    if(row)Object.assign(row,{status:'sending',error:null,attempts:row.attempts+1,updated_at:new Date().toISOString()});
    else {row={announcement_id:args.p_id,page_id:args.p_page,message:args.p_message,image_url:args.p_image,status:'sending',attempts:1,updated_at:new Date().toISOString()};tables.facebook_deliveries.push(row);}
    return {data:[row],error:null};
  }};
  const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',PORTAL_URL:'https://portal.test',FACEBOOK_REDIRECT_URI:'https://portal.test/shared/facebook-callback.html',FACEBOOK_GRAPH_VERSION:'v25.0',FACEBOOK_TOKEN_KEY:Buffer.alloc(32,1).toString('base64'),FIREBASE_WEB_API_KEY:'test-only',FIREBASE_PROJECT_ID:'test',FACEBOOK_APP_ID:'test-app',FACEBOOK_APP_SECRET:'test-only'};
  const apiFetch=async(url,options)=>{
    url=String(url);
    if(url.includes('identitytoolkit'))return Response.json({users:[{localId:'officer1',disabled,customAttributes:JSON.stringify(claims)}]});
    if(url.includes('/users/'))return Response.json(wire(profile));
    if(url.includes('/announcements/'))return Response.json(wire({title:'Test',content:'Content',facebookRequested:true,imageUrl:''}));
    if(String(url).includes('graph.facebook.com')){
      graphCalls++;
      if(url.includes('/oauth/access_token'))return Response.json({access_token:'private-user-token'});
      if(url.includes('/me/accounts'))return Response.json({data:[{id:'123',name:'Official Page',access_token:'new-private-page-token',tasks:['CREATE_CONTENT']}]});
      if(graphFailure==='network')throw new TypeError('Network failed');
      if(graphFailure==='reject')return Response.json({error:{code:190}},{status:400});
      await new Promise(resolve=>setTimeout(resolve,5));
      return Response.json({id:'123_456'});
    }
    throw Error('Unexpected request');
  };
  const init=new Function('createClient','isAdministrator','canPublish','deliveryMessage','Deno','fetch',source+'\nreturn {seal};');
  const helpers=init(()=>db,isAdministrator,canPublish,deliveryMessage,{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},apiFetch);
  tables.facebook_connection.push({id:true,page_id:'123',page_name:'Official Page',token_cipher:await helpers.seal('private-page-token')});
  return {tables,get graphCalls(){return graphCalls;},setFailure(value){graphFailure=value;},async call(action,body={}){
    const response=await handler(new Request('https://test.supabase.co/functions/v1/usc-facebook',{method:'POST',headers:{Origin:'https://portal.test','Content-Type':'application/json','x-firebase-token':'verified-test-token'},body:JSON.stringify({action,...body})}));
    return {status:response.status,...await response.json()};
  }};
}
test('status never returns Page credentials; officers cannot start administrator OAuth',async()=>{
  const h=await harness();const result=await h.call('status');
  assert.equal(result.connected,true);assert.equal(result.canConnect,false);
  assert.equal(JSON.stringify(result).includes('private-page-token'),false);
  assert.equal('token_cipher' in result,false);
  assert.equal((await h.call('begin')).status,403);
});
test('disabled accounts and custom read-only officers cannot publish',async()=>{
  const disabled=await harness({disabled:true});assert.equal((await disabled.call('publish',{announcementId:'a'})).ok,false);
  const readonly=await harness({profile:{...officer,officerPermissionSource:'custom',officerPermissions:[]}});
  assert.equal((await readonly.call('publish',{announcementId:'a'})).status,403);assert.equal(readonly.graphCalls,0);
});
test('concurrent publishing and later repeats send only one Facebook post',async()=>{
  const h=await harness();await Promise.all([h.call('publish',{announcementId:'a'}),h.call('publish',{announcementId:'a'})]);
  assert.equal(h.graphCalls,1);
  assert.equal((await h.call('publish',{announcementId:'a'})).delivery.status,'succeeded');assert.equal(h.graphCalls,1);
});
test('confirmed failures retry the Facebook delivery without a second Bulletin write',async()=>{
  const h=await harness({graphFailure:'reject'});
  assert.equal((await h.call('publish',{announcementId:'a'})).delivery.status,'failed');
  h.setFailure(null);assert.equal((await h.call('publish',{announcementId:'a'})).delivery.status,'succeeded');
  assert.equal(h.graphCalls,2);assert.equal(h.tables.facebook_deliveries.length,1);
});
test('ambiguous network failures are not resent by retry',async()=>{
  const h=await harness({graphFailure:'network'});assert.equal((await h.call('publish',{announcementId:'a'})).delivery.status,'uncertain');
  h.setFailure(null);assert.equal((await h.call('publish',{announcementId:'a'})).delivery.status,'uncertain');assert.equal(h.graphCalls,1);
});
test('OAuth completion requires the initiating administrator and browser verifier',async()=>{
  const h=await harness({profile:{...officer,role:'admin'},claims:{role:'admin'}});
  const result=await h.call('complete',{state:'invented',verifier:'invented',code:'invented'});
  assert.equal(result.ok,false);assert.equal(h.graphCalls,0);
});

test('admin OAuth exchanges and selects a Page without returning any tokens',async()=>{
  const h=await harness({profile:{...officer,role:'admin'},claims:{role:'admin'}});
  const verifier='a'.repeat(64);
  const begin=await h.call('begin',{verifier});assert.equal(begin.ok,true);
  const state=new URL(begin.url).searchParams.get('state');
  assert.equal((await h.call('complete',{state,verifier:'wrong',code:'code'})).ok,false);
  const complete=await h.call('complete',{state,verifier,code:'code'});
  assert.deepEqual(complete.pages,[{id:'123',name:'Official Page'}]);
  assert.equal(JSON.stringify(complete).includes('token'),false);
  const connected=await h.call('connect',{state,verifier,pageId:'123'});assert.equal(connected.ok,true);
  assert.equal(h.tables.facebook_connection[0].token_cipher.includes('new-private-page-token'),false);
  assert.equal((await h.call('connect',{state,verifier,pageId:'123'})).ok,false);
});
