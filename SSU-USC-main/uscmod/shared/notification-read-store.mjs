// Read flags are monotonic and belong to the authenticated UID, across modules.
export function createNotificationReadStore({uid,isCurrentOwner,call,storage,onChange=()=>{},onSyncError=()=>{}}) {
  const key=`uscNotificationRead:${uid}`;
  const valid=id=>typeof id==='string'&&id.length<=512&&/^(announcement|event|program|complaint):[^/\u0000-\u001f]+$/.test(id);
  let reads=new Set(),confirmed=new Set(),loaded=false,inFlight=null;
  function cache(){try{const saved=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(saved))saved.filter(valid).forEach(id=>reads.add(id));}catch{}return reads;}
  function persist(){try{storage?.setItem(key,JSON.stringify([...reads].sort()));}catch{/* Keep the account-backed state usable when browser storage is blocked. */}}
  function getRead(){return new Set(cache());}
  async function sync({refresh=false}={}) {
    if(!uid||!isCurrentOwner())return;
    if(inFlight){await inFlight;if(isCurrentOwner()&&refresh)return sync({refresh:true});return;}
    inFlight=(async()=>{
      cache();
      if(!loaded||refresh){let after=null;do{
        const response=await call('notificationReadList',after?{after}:{});
        if(!isCurrentOwner())return;
        for(const id of response.ids||[])if(valid(id)){reads.add(id);confirmed.add(id);}
        after=response.next;
      }while(after);loaded=true;persist();onChange();}
      while(isCurrentOwner()){
        const pending=[...cache()].filter(id=>!confirmed.has(id)).slice(0,100);
        if(!pending.length)break;
        await call('notificationReadMark',{ids:pending});
        if(!isCurrentOwner())return;
        pending.forEach(id=>confirmed.add(id));persist();
      }
      if(isCurrentOwner())onSyncError(false);
    })();
    try{await inFlight;}catch(error){if(isCurrentOwner())onSyncError(true,error);throw error;}finally{inFlight=null;}
  }
  function mark(ids){if(!uid||!isCurrentOwner())return;cache();for(const id of ids)if(valid(id))reads.add(id);persist();onChange();void sync().catch(()=>{});}
  cache();
  return {getRead,mark,sync,key};
}
