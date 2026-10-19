// Trusted, single-account operations. No Auth account, UID, password, or role is
// changed when linking an institutional login; it points to the existing Auth email.
const normalized = value => String(value || '').trim().toLowerCase();
const internal = value => /@(?:student\.)?ssu-usc\.local$/.test(normalized(value));
const contactEmail = profile => {
  const email = normalized(profile?.institutionalEmail || profile?.email);
  return internal(email) ? '' : email;
};
export function institutionalAddress(value) {
  const email = normalized(value);
  if (email.length > 200 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ssu\.edu\.ph$/.test(email)) throw new Error('Use your university-issued @ssu.edu.ph email address.');
  return email;
}
function recent(user, now) {
  if (!Number.isFinite(user.authTime) || user.authTime > now / 1000 + 60 || now / 1000 - user.authTime > 600) throw new Error('For security, sign in again before making this change.');
}
function ownsAlias(alias, user) {
  return !alias || (alias.uid ? alias.uid === user.uid : normalized(alias.authEmail) === normalized(user.email));
}
function patch(record, path, data) {
  return { path, data, version: record?.version || null };
}

export function createInstitutionalAccountService(deps) {
  const now = () => deps.now ? deps.now() : Date.now();
  async function account(user) {
    const profile = await deps.get(`users/${user.uid}`);
    if (!deps.activeProfile(profile?.data)) throw new Error('An approved active student or officer account is required.');
    const auth = await deps.authUser(user.uid);
    if (!auth || auth.disabled || normalized(auth.email) !== normalized(user.email)) throw new Error('Your account session has changed. Sign in again.');
    return { profile, auth };
  }
  async function available(email, user) {
    const [alias, authOwner] = await Promise.all([
      deps.get(`login_aliases/email_${await deps.sha256(email)}`), deps.authByEmail(email)
    ]);
    if (!ownsAlias(alias?.data, user) || (authOwner && authOwner.uid !== user.uid)) throw new Error('This institutional email is already associated with another account.');
    return alias;
  }
  return {
    async status(user) {
      const { profile, auth } = await account(user);
      const email = contactEmail(profile.data);
      const pending = await deps.get(`institutional_email_requests/${user.uid}`);
      return { ok: true, email, verified: Boolean(email && (profile.data.institutionalEmailVerified === true || (auth.emailVerified && normalized(auth.email) === email))), pendingEmail: pending?.data?.expiresAtMs > now() ? pending.data.email : '' };
    },
    async request(user, value) {
      const timestamp = now(); recent(user, timestamp);
      const email = institutionalAddress(value);
      const { profile } = await account(user);
      const current = contactEmail(profile.data);
      if (profile.data.institutionalEmailVerified === true && current && current !== email) throw new Error('An institutional email is already linked. Contact the System Administrator to change it.');
      await available(email, user);
      const path = `institutional_email_requests/${user.uid}`;
      const existing = await deps.get(path);
      const day = new Date(timestamp).toISOString().slice(0, 10);
      if (timestamp - (existing?.data?.sentAtMs || 0) < 60000) throw new Error('Wait one minute before requesting another verification email.');
      const count = existing?.data?.day === day ? Number(existing.data.count || 0) : 0;
      if (count >= 5) throw new Error('The daily verification limit has been reached. Try again tomorrow.');
      const token = deps.randomToken();
      await deps.commit([patch(existing, path, { uid: user.uid, email, authEmail: normalized(user.email), tokenHash: await deps.sha256(token), expiresAtMs: timestamp + 86400000, sentAtMs: timestamp, day, count: count + 1 })]);
      await deps.sendVerification(email, token);
      return { ok: true, message: 'Verification email sent. Open the link while signed in to this account.', email };
    },
    async verify(user, token) {
      if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw new Error('This verification link is invalid.');
      const path = `institutional_email_requests/${user.uid}`;
      const [pending, { profile }] = await Promise.all([deps.get(path), account(user)]);
      if (!pending || pending.data.tokenHash !== await deps.sha256(token) || pending.data.expiresAtMs <= now()) throw new Error('This verification link is expired, replaced, or already used. Request a new link in your profile.');
      if (pending.data.uid !== user.uid || normalized(pending.data.authEmail) !== normalized(user.email)) throw new Error('Sign in to the account that requested this verification link.');
      const email = institutionalAddress(pending.data.email);
      const oldEmail = contactEmail(profile.data);
      if (profile.data.institutionalEmailVerified === true && oldEmail && oldEmail !== email) throw new Error('Another institutional email is already linked.');
      const studentId = String(profile.data.studentId || '');
      if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/i.test(studentId)) throw new Error('The account has no valid Student ID. Contact the System Administrator.');
      const alias = await available(email, user);
      const idPath = `login_aliases/id_${studentId}`;
      const idAlias = await deps.get(idPath);
      if (!ownsAlias(idAlias?.data, user)) throw new Error('Student ID ownership could not be confirmed. Contact the System Administrator.');
      const emailPatch = { institutionalEmail: email, institutionalEmailVerified: true, email, authEmail: normalized(user.email), updatedAtMs: now() };
      const writes = [
        patch(profile, `users/${user.uid}`, emailPatch),
        patch(alias, `login_aliases/email_${await deps.sha256(email)}`, { authEmail: normalized(user.email), kind: 'institutionalEmail', uid: user.uid, verified: true }),
        patch(idAlias, idPath, { authEmail: normalized(user.email), kind: 'studentId', uid: user.uid }),
        { path, remove: true, version: pending.version }
      ];
      for (const collection of ['student_id_claims', 'school_accounts', 'student_masterlist']) {
        const recordPath = `${collection}/${studentId}`, record = await deps.get(recordPath);
        if (record?.data?.uid && record.data.uid !== user.uid) throw new Error('Account ownership records conflict. Contact the System Administrator.');
        if (record) writes.push(patch(record, recordPath, { institutionalEmail: email, institutionalEmailVerified: true, ...(collection === 'student_masterlist' ? {} : { authEmail: normalized(user.email) }) }));
      }
      writes.push({ path: `audit_logs/${deps.randomToken()}`, version: null, data: { action: 'INSTITUTIONAL_EMAIL_LINKED', actorUid: user.uid, targetUid: user.uid, targetStudentId: studentId, createdAtMs: now(), source: 'trusted-email-service' } });
      // Preconditioned atomic commit: concurrent requests cannot steal an alias,
      // replay a consumed token, or overwrite a changed profile/identity record.
      await deps.commit(writes);
      return { ok: true, email, message: 'Institutional email verified. Use your Student ID or this email with your existing password.', role: profile.data.role };
    },
    async resetPassword(user, uid) {
      const timestamp = now(); recent(user, timestamp);
      const admin = await deps.get(`users/${user.uid}`);
      if (user.role !== 'admin' || admin?.data?.role !== 'admin' || admin.data.accountStatus !== 'approved' || admin.data.isActive === false) throw new Error('Trusted System Administrator access is required.');
      if (!uid || uid === user.uid || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) throw new Error('Select a student or officer account.');
      const target = await deps.get(`users/${uid}`), auth = await deps.authUser(uid);
      if (!target || !['student', 'officer'].includes(target.data.role) || !auth || auth.disabled) throw new Error('A valid student or officer account is required.');
      const temporaryPassword = `Aa1!${deps.randomToken().slice(0,20)}`;
      await deps.resetAuthPassword(uid, temporaryPassword, timestamp);
      let warning = '';
      try {
        await deps.commit([
          { path: `users/${uid}`, version: target.version, data: { passwordResetIssuedAtMs: timestamp, passwordResetIssuedByUid: user.uid, updatedAtMs: timestamp } },
          { path: `audit_logs/${deps.randomToken()}`, version: null, data: { action: 'USER_PASSWORD_RESET', actorUid: user.uid, targetUid: uid, targetStudentId: target.data.studentId || '', createdAtMs: timestamp, source: 'trusted-email-service' } }
        ]);
      } catch { warning = 'Password changed, but reset metadata could not be saved. Contact the system maintainer.'; }
      // The password is returned only to the authenticated admin, never persisted.
      return { ok: true, reset: true, uid, fullName: target.data.fullName || 'User', studentId: target.data.studentId || '', role: target.data.role, institutionalEmail: contactEmail(target.data), temporaryPassword, warning };
    }
  };
}
