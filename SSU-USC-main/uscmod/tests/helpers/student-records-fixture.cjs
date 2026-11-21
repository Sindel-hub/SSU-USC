const {createStudentRecordHandlers}=require('../../functions/student-records');
const {studentUid}=require('../../functions/student-records-model');
function fixture(){
 const records=new Map(),authUsers=new Map(),sent=[];let seq=0,queue=Promise.resolve(),now=Date.UTC(2026,10,21),failAuth=false,failSend=false,failEnable=false;
 const clone=v=>v===undefined?undefined:structuredClone(v);
 const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:records.has(path),data:()=>clone(records.get(path))});
 const set=(p,d,options)=>records.set(p,options?.merge?{...records.get(p),...clone(d)}:clone(d));
 function ref(path){return{path,id:path.split('/').at(-1),get:async()=>snap(path),set:async(d,o)=>set(path,d,o),update:async d=>{if(!records.has(path))throw Error('Missing document '+path);set(path,d,{merge:true});},collection:name=>query(path+'/'+name)};}
 function query(path,filters=[],sort=null,take=Infinity,after=null,group=false){return{doc:(id=String(++seq).padStart(20,'A'))=>ref(path+'/'+id),where:(field,op,value)=>query(path,[...filters,[field,op,value]],sort,take,after,group),orderBy:(field,dir)=>query(path,filters,[field,dir],take,after,group),limit:n=>query(path,filters,sort,n,after,group),startAfter:value=>query(path,filters,sort,take,value,group),get:async()=>{
 let found=[...records.keys()].filter(p=>group?p.split('/').at(-2)===path:p.startsWith(path+'/')&&p.split('/').length===path.split('/').length+1).map(p=>snap(p));
 found=found.filter(d=>filters.every(([k,op,v])=>op==='in'?v.includes(d.data()[k]):d.data()[k]===v));
 if(sort)found.sort((a,b)=>{const av=sort[0]==='__name__'?a.id:a.data()[sort[0]],bv=sort[0]==='__name__'?b.id:b.data()[sort[0]];return(av<bv?-1:av>bv?1:0)*(sort[1]==='desc'?-1:1);});
 if(after)found=found.filter(d=>d.id>after);found=found.slice(0,take);return{docs:found,size:found.length,empty:!found.length};}};}
 const db={doc:ref,collection:query,collectionGroup:name=>query(name,[],null,Infinity,null,true),runTransaction:fn=>{const job=queue.then(async()=>{const pending=[];let wrote=false;const tx={get:async r=>{if(wrote)throw Error('Read after write');return snap(r.path);},delete:r=>{wrote=true;pending.push(()=>records.delete(r.path));},set:(r,d,o)=>{wrote=true;pending.push(()=>set(r.path,d,o));},create:(r,d)=>{wrote=true;if(records.has(r.path))throw Error('Document already exists');pending.push(()=>set(r.path,d));},update:(r,d)=>{wrote=true;pending.push(()=>{if(!records.has(r.path))throw Error('Missing doc');set(r.path,d,{merge:true});});}};const out=await fn(tx);pending.forEach(fn=>fn());return out;});queue=job.catch(()=>{});return job;}};
 const authError=code=>Object.assign(Error(code),{code});
 const adminAuth={getUser:async uid=>{if(!authUsers.has(uid))throw authError('auth/user-not-found');return clone(authUsers.get(uid));},getUserByEmail:async email=>{const u=[...authUsers.values()].find(u=>u.email===email);if(!u)throw authError('auth/user-not-found');return clone(u);},createUser:async u=>{if(authUsers.has(u.uid))throw authError('auth/uid-already-exists');if([...authUsers.values()].some(v=>v.email===u.email))throw authError('auth/email-already-exists');authUsers.set(u.uid,clone(u));return clone(u);},setCustomUserClaims:async(uid,c)=>{authUsers.get(uid).customClaims=clone(c);},updateUser:async(uid,patch)=>{if(failEnable&&patch.disabled===false){failEnable=false;throw Error('Synthetic enable outage');}if(failAuth){failAuth=false;throw Error('Synthetic Auth outage');}if(!authUsers.has(uid))throw authError('auth/user-not-found');Object.assign(authUsers.get(uid),clone(patch));return clone(authUsers.get(uid));},revokeRefreshTokens:async uid=>{authUsers.get(uid).revoked=true;}};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 async function requireActiveRole(r){if(r.auth?.token?.role!=='admin'||!r.auth?.active)throw new HttpsError('permission-denied','Administrator only.');}
 const requireRecentAuth=r=>{if(!r.auth.recent)throw new HttpsError('failed-precondition','Sign in again.');};
 const handlers=createStudentRecordHandlers({db,adminAuth,requireActiveRole,requireRecentAuth,HttpsError,clock:()=>now,sendActivation:async msg=>{if(failSend)throw Error('Synthetic delivery outage');sent.push(msg);}});
 const admin={auth:{uid:'admin-test',token:{role:'admin'},active:true,recent:true}};
 function seed(profile,auth={}){const uid=profile.uid||studentUid(profile.studentId);records.set('users/'+uid,{uid,...profile});records.set('student_id_claims/'+profile.studentId,{uid});records.set('school_accounts/'+profile.studentId,{uid});authUsers.set(uid,{uid,email:profile.institutionalEmail||profile.email,disabled:false,emailVerified:true,customClaims:{role:profile.role},...auth});return uid;}
 return{records,authUsers,sent,db,adminAuth,handlers,admin,seed,get now(){return now;},advance:ms=>now+=ms,failNextAuth:()=>failAuth=true,failNextEnable:()=>failEnable=true,setFailEmail:v=>failSend=v};
}
module.exports={fixture};
