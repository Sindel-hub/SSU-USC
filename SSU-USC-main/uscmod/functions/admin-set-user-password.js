'use strict';

function chosenPasswordIsValid(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 64
    && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
    && /[^A-Za-z0-9\s]/.test(password);
}

function createAdminSetUserPassword({ requireActiveRole, requireRecentAuth, db, adminAuth, audit, FieldValue, HttpsError }) {
  return async request => {
    await requireActiveRole(request, ['admin']);
    requireRecentAuth(request);
    const uid = request.data?.uid;
    if (typeof uid !== 'string' || !uid.trim() || uid.length > 128 || uid.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid user UID is required.');
    }
    if (uid === request.auth.uid) throw new HttpsError('failed-precondition', 'Use your profile settings to change your own password.');
    const password = request.data?.password;
    if (!chosenPasswordIsValid(password)) {
      throw new HttpsError('invalid-argument', 'Use 10–64 characters, including uppercase, lowercase, a number, and a symbol.');
    }
    const profileRef = db.doc(`users/${uid}`);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
    const role = String(profileSnap.data()?.role || '').toLowerCase();
    if (!['student', 'officer'].includes(role)) throw new HttpsError('permission-denied', 'Only student and officer passwords can be changed here.');
    let authUser;
    try { authUser = await adminAuth.getUser(uid); }
    catch { throw new HttpsError('failed-precondition', 'The matching authentication account could not be verified.'); }
    if (String(authUser.customClaims?.role || '').toLowerCase() === 'admin') {
      throw new HttpsError('permission-denied', 'Administrator passwords cannot be changed here.');
    }
    try {
      // Preserve the administrator's exact input. Never trim, replace, log, or persist it elsewhere.
      await adminAuth.updateUser(uid, { password });
    } catch (error) {
      if (['auth/invalid-password', 'auth/password-does-not-meet-requirements'].includes(error?.code)) {
        throw new HttpsError('invalid-argument', 'The password does not meet the authentication password policy.');
      }
      throw new HttpsError('internal', 'The password change could not be confirmed. Please retry.');
    }
    const warnings = [];
    try { await adminAuth.revokeRefreshTokens(uid); }
    catch { warnings.push('Existing sessions could not be revoked immediately.'); }
    try {
      await profileRef.set({
        passwordResetIssuedAt: FieldValue.serverTimestamp(),
        passwordResetIssuedByUid: request.auth.uid,
        passwordResetMethod: 'admin-chosen',
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch { warnings.push('Password change metadata could not be saved.'); }
    try {
      await audit({ auth: request.auth }, 'USER_PASSWORD_SET', profileRef.path, null, { passwordChanged: true }, { targetRole: role });
    } catch { warnings.push('The audit entry could not be recorded.'); }
    return { changed: true, uid, warning: warnings.join(' ') };
  };
}

module.exports = { createAdminSetUserPassword, chosenPasswordIsValid };
