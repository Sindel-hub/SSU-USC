import {adminClient,firestoreVersionedGet,firestoreWorkflowCommit,firestoreWorkflowQuery,firebaseUserByUid,env,sendEmail,escapeHtml} from './usc-email-common.ts';
const supabase=adminClient();
export async function notificationGmail(uid:string){
 const {data,error}=await supabase.from('student_email_accounts').select('firebase_uid,requested_email,verified_email,verified_at').eq('firebase_uid',uid).maybeSingle();
 if(error)throw new Error('Email verification records are temporarily unavailable.');return data;
}
export const notificationIdentityDependencies={get:firestoreVersionedGet,authUser:firebaseUserByUid,gmail:notificationGmail};
export function notificationDeliveryDependencies(kind:string){return {...notificationIdentityDependencies,commit:firestoreWorkflowCommit,now:Date.now,portalUrl:env().portalUrl,
 finish:async(path:string,data:any)=>{const current=await firestoreVersionedGet(path);if(current)await firestoreWorkflowCommit([{path,version:current.version,data}])},
 send:async(to:string,message:any,_key:string)=>{try{return await sendEmail(to,message.subject,`<p>${escapeHtml(message.text).replaceAll('\n','<br>')}</p>`,message.text,kind)}catch(error){if(/^Email provider rejected the message \(4[0-9]{2}\)/.test(String((error as Error).message)))Object.assign(error as object,{deliveryRejected:true});throw error}}
};}
export async function deliverNotificationQueue(collection:string,kind:string,process:any){
 const deps=notificationDeliveryDependencies(kind);
 const stranded=await firestoreWorkflowQuery(collection,'','sending',100);
 for(const event of stranded)if(Date.now()-event.data.updatedAt>10*60*1000)await deps.finish(`${collection}/${event.id}`,{state:'unknown',failureCode:'delivery-unconfirmed',updatedAt:Date.now()});
 const queued=await firestoreWorkflowQuery(collection,'','queued',50);let sent=0;
 for(const event of queued)if(await process(event.id,deps))sent++;
 return {processed:queued.length,sent};
}
