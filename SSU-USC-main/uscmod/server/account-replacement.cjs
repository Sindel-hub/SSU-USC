'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { ServiceError } = require('./settings.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const normalizedName = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function createAccountReplacementHandlers({ db, adminAuth, requireActiveRole, requireRecentAuth, clock = Date.now }) {
  return { async accountReplace(request) {
    await requireActiveRole(request, ['admin']);
    requireRecentAuth(request);
    const input = request.data || {};
    const text = (key, max = 160) => String(input[key] || '').trim().slice(0, max);
    const studentId = text('studentId', 64), oldUid = text('previousUid', 128);
    const role = text('role'), fullName = text('fullName', 120);
    const institutionalEmail = text('institutionalEmail', 200).toLowerCase() || null;
    const password = String(input.temporaryPassword || '');
    if (!/^\d{1,64}$/.test(studentId) || !/^[\w:-]{1,128}$/.test(oldUid) || !['student','officer'].includes(role) || fullName.length < 2 || !text('college') || !text('program') || !text('yearLevel', 40) || password.length < 14 || password.length > 128 || (institutionalEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(institutionalEmail))) throw new ServiceError('invalid-argument', 'Invalid replacement account details.');
    const { permissionsForOfficerPosition } = await import('../shared/officer-permissions.js');
    const { normalizeStudentStanding, enrollmentStatusForStanding, isActiveStudentStanding, studentStandingLabel } = await import('../shared/student-standing.js');
    const officePosition = text('officePosition', 120);
    const positions = ['President','Vice President','Secretary','Treasurer','Auditor','Public Relations Officer (PRO)','Business Manager','Sgt. at Arms','Department Representative'];
    if (role === 'officer' && !positions.includes(officePosition)) throw new ServiceError('invalid-argument', 'Select a valid USC officer position.');
    const standing = normalizeStudentStanding(input.studentStanding, input.enrollmentStatus);
    const enrollmentStatus = enrollmentStatusForStanding(standing);
    const active = isActiveStudentStanding(standing, enrollmentStatus);
    const oldRef = db.doc(`users/${oldUid}`), claimRef = db.doc(`student_id_claims/${studentId}`);
    function eligible(profile) {
      return profile && ['student','officer'].includes(profile.role) && profile.studentId === studentId && profile.accountStatus === 'suspended' && profile.isActive === false && !profile.accountRemovalPending;
    }
    async function retireAuth() {
      try {
        await adminAuth.updateUser(oldUid, {disabled:true});
        await adminAuth.revokeRefreshTokens(oldUid);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
      }
    }
    async function finalizeRetirement() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await retireAuth(); return true; } catch { /* Profile retirement already blocks portal access. */ }
      }
      return false;
    }
    const old = (await oldRef.get()).data();
    // Retrying after a lost response also retries Auth retirement. Never transfer again.
    if (old?.accountRemoved && old.replacedByUid) {
      await retireAuth();
      throw new ServiceError('already-exists', 'Replacement already completed. Use the directory to reset the replacement account password if its login slip was lost.');
    }
    if (!eligible(old)) throw new ServiceError('failed-precondition', 'Only a suspended student or officer can be replaced.');
    let previousAuthUser = null;
    try { previousAuthUser = await adminAuth.getUser(oldUid); } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    // Each attempt has a separate disabled Auth identity. The transaction below
    // decides which attempt owns the ID before that identity can enter the portal.
    const uid = randomUUID(), authEmail = `${uid}@student.ssu-usc.local`;
    let committed = false;
    let created = false;
    try {
      await adminAuth.createUser({ uid, email: authEmail, password, displayName: fullName, disabled: true });
      created = true;
      await adminAuth.setCustomUserClaims(uid, { role });
      await adminAuth.updateUser(uid, { disabled: !active });
      await db.runTransaction(async tx => {
        const paths = [`student_id_claims/${studentId}`, `school_accounts/${studentId}`, `login_aliases/id_${studentId}`, `student_masterlist/${studentId}`];
        const nameKey = hash(normalizedName(fullName));
        paths.push(`student_name_claims/${nameKey}`);
        if (institutionalEmail) paths.push(`login_aliases/email_${hash(institutionalEmail)}`);
        const extraPaths = [];
        const oldName = normalizedName(String(old.fullName || ''));
        const oldEmail = String(old.institutionalEmail || '').trim().toLowerCase();
        if (oldName) extraPaths.push(`student_name_claims/${hash(oldName)}`);
        if (oldEmail) extraPaths.push(`login_aliases/email_${hash(oldEmail)}`);
        const releases = extraPaths.filter(path => !paths.includes(path));
        const extraSnapshots = await Promise.all(releases.map(path => tx.get(db.doc(path))));
        const snapshots = await Promise.all([tx.get(oldRef), ...paths.map(path => tx.get(db.doc(path)))]);
        if (!eligible(snapshots[0].data())) throw new ServiceError('failed-precondition', 'The previous account changed. Refresh the directory before retrying.');
        for (let i = 1; i < snapshots.length; i++) {
          const data = snapshots[i].data();
          if (!data || data.uid === oldUid) continue;
          const idOwnerConfirmed = snapshots[1].data()?.uid === oldUid;
          const legacyMasterlist = i === 4 && !data.uid && idOwnerConfirmed;
          const legacyLoginAlias = (i === 3 || i === 6) && !data.uid && idOwnerConfirmed
            && typeof data.authEmail === 'string' && Boolean(previousAuthUser?.email)
            && data.authEmail.trim().toLowerCase() === previousAuthUser.email.trim().toLowerCase();
          if (legacyMasterlist || legacyLoginAlias) continue;
          const label = ['Student ID reservation', 'School account', 'Student ID login', 'Student masterlist', 'Full name reservation', 'Email login'][i - 1];
          throw new ServiceError('already-exists', `${label} belongs to another account or its ownership could not be confirmed.`);
        }
        const now = clock();
        const profile = {uid, studentId, fullName, institutionalEmail, email: institutionalEmail || '', institutionalEmailVerified:false, authEmail, role, college:text('college'), program:text('program'), yearLevel:text('yearLevel',40), studentStanding:standing, enrollmentStatus, accountStatus:'approved', isActive:active, schoolProvisioned:true, isVerifiedStudent:active && input.eligible !== false, candidacyApproved:false, mustChangePassword:false, createdAt:new Date(now), updatedAt:new Date(now), updatedAtMs:now};
        if (role === 'officer') Object.assign(profile, {officePosition, roleEffectiveDate:text('roleEffectiveDate',40), officerPermissions:permissionsForOfficerPosition(officePosition), officerPermissionSource:'position-default'});
        tx.set(db.doc(`users/${uid}`), profile);
        tx.update(oldRef, {accountRemoved:true, accountRemovalPending:false, idReservationsReleased:true, replacedByUid:uid, accountStatus:'suspended', isActive:false, isVerifiedStudent:false, candidacyApproved:false, activationTokenHash:null, accountRemovedByUid:request.auth.uid, accountRemovedAtMs:now});
        tx.set(claimRef, {uid,studentId,institutionalEmail,authEmail,createdBy:request.auth.uid,updatedAt:new Date(now)});
        tx.set(db.doc(paths[1]), {uid,studentId,institutionalEmail,authEmail,active,isActive:active,studentStanding:standing,updatedAt:new Date(now)});
        tx.set(db.doc(paths[2]), {uid,authEmail,kind:'studentId',updatedAt:new Date(now)});
        tx.set(db.doc(paths[3]), {uid,studentId,fullName,institutionalEmail,program:profile.program,college:profile.college,yearLevel:profile.yearLevel,studentStanding:standing,enrollmentStatus,eligible:active,updatedAt:new Date(now)});
        tx.set(db.doc(paths[4]), {uid,studentId,nameKey,normalizedName:normalizedName(fullName),fullName,accountRole:role,createdBy:request.auth.uid,updatedAt:new Date(now)});
        if (institutionalEmail) tx.set(db.doc(paths[5]), {uid,authEmail,kind:'institutionalEmail',verified:false,updatedAt:new Date(now)});
        for (let i = 0; i < releases.length; i++) {
          if (extraSnapshots[i].data()?.uid === oldUid) tx.delete(db.doc(releases[i]));
        }
        tx.set(db.collection('audit_logs').doc(), {action:'ACCOUNT_REPLACED',actorUid:request.auth.uid,targetUid:oldUid,replacementUid:uid,targetStudentId:studentId,createdAt:new Date(now)});
      });
      committed = true;
      const retirementPending = !(await finalizeRetirement());
      return {ok:true,created:true,retirementPending,credential:{uid,studentId,fullName,institutionalEmail,college:text('college'),program:text('program'),yearLevel:text('yearLevel',40),studentStanding:standing,studentStandingLabel:studentStandingLabel(standing),officePosition,roleEffectiveDate:text('roleEffectiveDate',40),temporaryPassword:password}};
    } catch (error) {
      // A transaction may commit even if its acknowledgement is lost.
      committed = (await oldRef.get()).data()?.replacedByUid === uid;
      if (committed) { const retirementPending = !(await finalizeRetirement()); return {ok:true,created:true,retirementPending,credential:{uid,studentId,fullName,institutionalEmail,temporaryPassword:password}}; }
      if (created) await adminAuth.deleteUser(uid);
      throw error;
    }
  }};
}
module.exports = {createAccountReplacementHandlers};
