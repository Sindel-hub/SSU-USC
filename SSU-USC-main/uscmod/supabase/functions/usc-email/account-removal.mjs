// Removal archives the UID; historical election/complaint/audit records remain.
// Only release a directory slot when its UID-bearing records agree.
async function ownedReservations(deps, uid, profile) {
  const id = profile.studentId;
  if (!/^\d{1,64}$/.test(id || '')) return [];
  const writes = [];
  for (const path of [`student_id_claims/${id}`, `school_accounts/${id}`, `login_aliases/id_${id}`]) {
    const record = await deps.get(path);
    if (!record) continue;
    if (record.data.uid !== uid) throw Error('Student ID ownership conflicts. Review the directory records before removal.');
    writes.push({path, version:record.version, remove:true});
  }
  const masterPath = `student_masterlist/${id}`;
  const master = await deps.get(masterPath);
  if (master) {
    if (master.data.uid ? master.data.uid !== uid : !writes.length || master.data.studentId !== id)
      throw Error('Cannot confirm ownership of the masterlist record.');
    writes.push({path:masterPath, version:master.version, remove:true});
  }
  const name = String(profile.fullName || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const email = String(profile.institutionalEmail || '').trim().toLowerCase();
  for (const [prefix,value] of [['student_name_claims/',name],['login_aliases/email_',email]]) {
    if (!value) continue;
    const path = prefix + await deps.sha256(value);
    const record = await deps.get(path);
    if (record?.data.uid === uid) writes.push({path,version:record.version,remove:true});
  }
  return writes;
}
export function createAccountRemovalService(deps) {
  return async function removeSuspendedAccount(actor, uid) {
    const now = deps.now ? deps.now() : Date.now();
    if (!Number.isFinite(actor.authTime) || actor.authTime > now / 1000 + 60 || now / 1000 - actor.authTime > 600) throw Error('Sign in again before removing an account.');
    const admin = await deps.get(`users/${actor.uid}`);
    if (actor.disabled === true || actor.role !== 'admin' || admin?.data?.role !== 'admin' || admin.data.accountStatus !== 'approved' || admin.data.isActive === false) throw Error('Active trusted administrator access is required.');
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid) || uid === actor.uid) throw Error('Select another student or officer account.');
    const path = `users/${uid}`;
    let target = await deps.get(path);
    if (!target || !['student','officer'].includes(target.data.role) || target.data.accountStatus !== 'suspended' || target.data.isActive !== false) throw Error('Suspend the student or officer account before removing it.');
    if (target.data.idReservationsReleased === true) return {ok:true,removed:true};
    if (!target.data.accountRemovalPending) {
      await deps.commit([
        {path,version:target.version,data:{accountRemovalPending:true,accountRemovalStartedByUid:actor.uid,accountRemovalStartedAtMs:now}},
        {path:`audit_logs/${deps.randomToken()}`,version:null,data:{action:'USER_REMOVAL_STARTED',actorUid:actor.uid,targetUid:uid,createdAtMs:now,source:'trusted-email-service'}}
      ]);
      target = await deps.get(path);
    }
    // Failures leave a suspended, visible pending record that admins may retry.
    const releases = await ownedReservations(deps, uid, target.data);
    await deps.disableAuth(uid, now);
    await deps.unlinkGmail(uid);
    await deps.commit([
      {path,version:target.version,data:{idReservationsReleased:true,activationTokenHash:null,accountRemoved:true,accountRemovalPending:false,accountRemovedByUid:actor.uid,accountRemovedAtMs:now,accountStatus:'suspended',isActive:false,isVerifiedStudent:false,candidacyApproved:false,updatedAtMs:now}},
      ...releases,
      {path:`audit_logs/${deps.randomToken()}`,version:null,data:{action:'USER_REMOVED',actorUid:actor.uid,targetUid:uid,createdAtMs:now,source:'trusted-email-service',gmailDetached:true}}
    ]);
    return {ok:true,removed:true};
  };
}
