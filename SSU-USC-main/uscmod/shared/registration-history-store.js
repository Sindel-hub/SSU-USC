import { auth, db } from "../firebase/firebase-config.js";
import { doc, collection, getDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { effectiveOfficerPermissions } from "./officer-permissions.js";
export const registrationFields = { fullName:120, position:80, department:160, program:160, college:160, partylist:100, platform:4000 };
export function historyElectionStatus(election, now = Date.now()) {
  const ms=value=>value?.toMillis?.() || Number(value) || 0;
  if (election.scheduleDeleted) return "Schedule Deleted";
  if (election.archived) return "Archived";
  if (election.finalized || election.resultsPublished || (ms(election.votingEnd) && now>=ms(election.votingEnd))) return "Completed";
  return ms(election.registrationStart)>now ? "Upcoming" : "Ongoing";
}
export async function manageCandidateRegistration({electionId,registrationId,details,remove=false}) {
  if (!auth.currentUser) throw new Error("Sign in again before managing registrations.");
  if (![electionId,registrationId].every(value=>typeof value==='string'&&value&&!value.includes('/'))) throw new Error("Select a valid registration and election.");
  const uid=auth.currentUser.uid,profile=(await getDoc(doc(db,'users',uid))).data()||{};
  if(profile.isActive===false||profile.accountStatus!=='approved'||(profile.role==='officer'&&profile.studentStanding&&profile.studentStanding!=='active'))throw new Error('An active, approved officer account is required.');
  if (profile.role!=='admin' && !effectiveOfficerPermissions(profile).includes('elections.review')) throw new Error("Candidate review permission is required.");
  const ref=doc(db,'elections',electionId,'applications',registrationId),audit=doc(collection(db,'audit_logs'));
  await runTransaction(db,async tx=>{
    const [application,election]=await Promise.all([tx.get(ref),tx.get(doc(db,'elections',electionId))]);
    if (!application.exists() || application.data().removed) throw new Error("This registration is no longer available.");
    const before=application.data(),state=election.exists()?election.data():before.electionSnapshot||{};
    const candidateId=String(before.candidateId||'');
    if (candidateId.includes('/')) throw new Error("Invalid candidate association. Contact an administrator.");
    const candidateRef=candidateId?doc(db,'elections',electionId,'candidates',candidateId):null;
    const candidate=candidateRef?await tx.get(candidateRef):null;
    const changes={updatedAt:serverTimestamp(),updatedByUid:uid,historyAuditId:audit.id};
    if(remove) changes.removed=true;
    else {
      for(const [key,limit] of Object.entries(registrationFields)) {
        changes[key]=String(details?.[key]??before[key]??'').trim();
        if(changes[key].length>limit)throw new Error(`${key} exceeds ${limit} characters.`);
      }
      if(!changes.fullName||!changes.position)throw new Error("Name and position are required.");
      const start=state.votingStart?.toMillis?.()||Number(state.votingStart)||0;
      if((!start||Date.now()>=start)&&(changes.position!==before.position||changes.department!==(before.department||'')))throw new Error("Position and department cannot change after voting starts or when election dates are unavailable.");
    }
    if(candidate?.exists()&&!candidate.data().removed) {
      const original=candidate.data();
      if(remove) {
        tx.update(candidateRef,{removed:true,resultIdentity:original.resultIdentity||original,updatedAt:serverTimestamp(),updatedByUid:uid,registrationAuditId:audit.id});
      } else if(election.exists()) {
        const candidateAudit=doc(collection(db,'audit_logs'));
        const patch=Object.fromEntries(['fullName','position','department','partylist','platform'].map(key=>[key,changes[key]]));
        if(Date.now()>=(state.votingStart?.toMillis?.()||Number(state.votingStart)||0)&&!original.resultIdentity)patch.resultIdentity=original;
        Object.assign(patch,{updatedAt:serverTimestamp(),updatedByUid:uid,managementAuditId:candidateAudit.id});
        tx.update(candidateRef,patch);
        tx.set(candidateAudit,{actorUid:uid,electionId,candidateId,action:'CANDIDATE_EDIT',target:candidateRef.path,source:'browser-election-runtime',before:original,after:{...original,...patch},createdAt:serverTimestamp()});
      }
    }
    tx.update(ref,changes);
    tx.set(audit,{actorUid:uid,electionId,registrationId,action:remove?'REGISTRATION_DELETE':'REGISTRATION_EDIT',target:ref.path,source:'registration-history',before,after:{...before,...changes},createdAt:serverTimestamp()});
  });
}
