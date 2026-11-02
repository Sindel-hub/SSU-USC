// Removal archives the UID; historical election/complaint/audit records remain.
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
    if (target.data.accountRemoved === true) return {ok:true,removed:true};
    if (!target.data.accountRemovalPending) {
      await deps.commit([
        {path,version:target.version,data:{accountRemovalPending:true,accountRemovalStartedByUid:actor.uid,accountRemovalStartedAtMs:now}},
        {path:`audit_logs/${deps.randomToken()}`,version:null,data:{action:'USER_REMOVAL_STARTED',actorUid:actor.uid,targetUid:uid,createdAtMs:now,source:'trusted-email-service'}}
      ]);
      target = await deps.get(path);
    }
    // Failures leave a suspended, visible pending record that admins may retry.
    await deps.disableAuth(uid, now);
    await deps.unlinkGmail(uid);
    await deps.commit([
      {path,version:target.version,data:{accountRemoved:true,accountRemovalPending:false,accountRemovedByUid:actor.uid,accountRemovedAtMs:now,accountStatus:'suspended',isActive:false,isVerifiedStudent:false,candidacyApproved:false,updatedAtMs:now}},
      {path:`audit_logs/${deps.randomToken()}`,version:null,data:{action:'USER_REMOVED',actorUid:actor.uid,targetUid:uid,createdAtMs:now,source:'trusted-email-service',gmailDetached:true}}
    ]);
    return {ok:true,removed:true};
  };
}
