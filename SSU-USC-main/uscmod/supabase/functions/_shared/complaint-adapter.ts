import {firestoreVersionedGet,firestoreWorkflowCommit,firestoreWorkflowQuery,randomToken} from './usc-email-common.ts';
import {notificationIdentityDependencies,deliverNotificationQueue} from './notification-adapter.ts';
import {effectiveOfficerPermissions} from '../../../shared/officer-permissions.js';
import {createComplaintWorkflow,processComplaintNotification,complaintFirestoreOperations} from './complaint-workflow.mjs';
export const complaintWorkflow=createComplaintWorkflow({...notificationIdentityDependencies,get:firestoreVersionedGet,commit:(operations:any[])=>firestoreWorkflowCommit(complaintFirestoreOperations(operations)),randomId:()=>randomToken().slice(0,32),
 hasPermission:(profile:any,user:any,permission:string)=>(profile.role==='admin'&&user.role==='admin')||(profile.role==='officer'&&effectiveOfficerPermissions(profile).includes(permission)),
 draftChunks:(uid:string,requestId:string)=>firestoreWorkflowQuery('attachmentChunks',`complaint_drafts/${uid}/entries/${requestId}`,'',10).then(rows=>rows.sort((a,b)=>a.data.index-b.data.index))
});
export async function deliverComplaintEvents(){return deliverNotificationQueue('complaint_email_events','complaint-update',processComplaintNotification);}
