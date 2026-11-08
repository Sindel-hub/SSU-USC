// Shared by candidate and complaint mail. This module never stores recipients,
// logs message bodies, or rolls back a domain record when delivery fails.
export async function processVerifiedNotification(collection,eventId,deps,prepare){
 const path=`${collection}/${eventId}`,record=await deps.get(path);if(!record||record.data.state!=='queued')return false;
 const event=record.data,attempts=(event.attempts||0)+1;
 try{await deps.commit([{path,version:record.version,data:{state:'sending',attempts,updatedAt:deps.now()}}])}catch{return false}
 let sending=false;
 try{
  const ready=await prepare(event);
  if(!ready){await deps.finish(path,{state:'cancelled',updatedAt:deps.now()});return false;}
  sending=true;
  const providerId=await deps.send(ready.recipient,ready.message,`${eventId}-${attempts}`);
  if(!providerId)throw new Error('Delivery could not be confirmed.');
  await deps.finish(path,{state:'sent',providerId,updatedAt:deps.now()});return true;
 }catch(error){
  await deps.finish(path,{state:sending&&!error.deliveryRejected?'unknown':'failed',failureCode:sending?(error.deliveryRejected?'provider-rejected':'delivery-unconfirmed'):error.code||'recipient-unavailable',updatedAt:deps.now()}).catch(()=>{});return false;
 }
}
export async function retryVerifiedNotification(collection,eventId,user,deps,action='NOTIFICATION_RETRY'){
 if(!/^[a-f0-9]{64}$/.test(eventId))throw Object.assign(new Error('Select a valid notification.'),{code:'invalid-argument'});
 const path=`${collection}/${eventId}`,record=await deps.get(path);
 if(!record||record.data.state!=='failed')throw Object.assign(new Error('Only a confirmed failed notification can be retried. Unconfirmed delivery requires administrator reconciliation.'),{code:'failed-precondition'});
 await deps.commit([{path,version:record.version,data:{state:'queued',updatedAt:deps.now(),retryByUid:user.uid}},{path:`audit_logs/${deps.randomId()}`,version:null,data:{actorUid:user.uid,action,target:path,createdAt:deps.now(),source:'trusted-notification-service'}}]);return {ok:true,state:'queued'};
}
