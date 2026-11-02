const normalized = value => String(value || '').trim().toLowerCase();
const validMapping = (mapping, email) => Boolean(mapping?.firebase_uid && mapping.verified_at
  && mapping.requested_email === email && mapping.verified_email === email);

// A disabled/suspended legacy student/officer does not own the *login mapping*.
// Its Firebase account/email is not changed. Active, admin or unknown conflicts
// stay blocked; a future reactivation makes this mapping fail closed again.
async function inactiveLegacyOwner(deps, owner) {
  const [profile, auth] = await Promise.all([deps.profile(owner.uid), deps.authUser(owner.uid)]);
  return Boolean(profile && auth?.uid === owner.uid && ['student', 'officer'].includes(normalized(profile.role))
    && (auth.disabled === true || profile.isActive === false || normalized(profile.accountStatus) === 'suspended'));
}

async function nativeOwner(deps, input) {
  const original = normalized(input), canonical = deps.canonicalGmail(input);
  let found = null;
  for (const email of new Set([original, canonical].filter(Boolean))) {
    const owner = await deps.authByEmail(email);
    if (!owner) continue;
    if (found && found.uid !== owner.uid) return null;
    found = owner;
  }
  return found;
}

// Resolve verified Gmail against the authoritative recovery record on every login.
// No aliases are persisted: changing/removing Gmail immediately revokes this route.
export async function resolveVerifiedGmailAccount(deps, input) {
  const email = deps.canonicalGmail(input);
  if (!email) return null;
  const account = await deps.verifiedAccount(email);
  if (!account?.firebase_uid || !account.verified_at
      || account.requested_email !== email || account.verified_email !== email) return null;
  const uid = String(account.firebase_uid);
  const profile = await deps.profile(uid);
  if (!deps.activeProfile(profile)) return null;
  const user = await deps.authUser(uid);
  if (!user || user.uid !== uid || user.disabled || !user.email) return null;
  // A Gmail already owned by another Firebase account cannot redirect that account.
  for (const address of new Set([email, String(input || '').trim().toLowerCase()])) {
    const owner = await deps.authByEmail(address);
    if (owner && owner.uid !== uid && !await inactiveLegacyOwner(deps, owner)) return null;
  }
  return { uid, authEmail: user.email };
}

export const GMAIL_LOGIN_FAILURE = 'Unable to sign in. Check your credentials or use your Student ID.';

// Password proof is required before returning any account metadata. Every failed
// identity/verification/password check has the same public status and response.
export function createGmailPasswordAuthenticator(deps) {
  return async function authenticate(input = {}, clientAddress = '') {
    const start = Date.now();
    const email = typeof input.email === 'string' && input.email.length <= 254 ? deps.canonicalGmail(input.email) : '';
    const password = typeof input.password === 'string' && input.password.length <= 4096 ? input.password : '';
    let result;
    try {
      let allowed;
      try { allowed = await deps.consumeBudget(email || '<invalid>', clientAddress); }
      catch { return {status:503, body:{ok:false, message:'Sign-in is temporarily unavailable. Use your Student ID.'}}; }
      if (!allowed) return {status:429, body:{ok:false, message:'Too many sign-in attempts. Try again later or use your Student ID.'}};
      if (!email || !password) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
      const mapping = await deps.verifiedAccount(email);
      const verified = validMapping(mapping, email);
      // The verified mapping wins before password verification. Never try a
      // different UID when a mapped account/password is ineligible or incorrect.
      const native = verified ? null : await nativeOwner(deps, input.email);
      const targetUid = verified ? String(mapping.firebase_uid) : native?.uid;
      const user = await deps.authUser(targetUid || 'unavailable-gmail-login');
      const candidate = targetUid && user?.uid === targetUid && !user.disabled && user.email;
      const identity = await deps.passwordIdentity(candidate || 'unavailable@invalid.invalid', password);
      if (!candidate || identity?.uid !== targetUid) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
      let account;
      let loginMethod;
      if (verified) {
        // Re-read mapping/ownership/eligibility after proof; revocations and UID
        // changes during verification cannot authenticate a stale target.
        account = await resolveVerifiedGmailAccount(deps, input.email);
        loginMethod = 'verified-gmail';
      } else {
        // A mapping added while native proof was in flight must not be bypassed.
        const refreshed = await deps.verifiedAccount(email);
        if (validMapping(refreshed, email)) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
        const owner = await nativeOwner(deps, input.email);
        const auth = await deps.authUser(targetUid);
        const profile = await deps.profile(targetUid);
        if (!owner || owner.uid !== targetUid || !auth || auth.uid !== targetUid || auth.disabled
            || auth.email !== user.email || !deps.activeNativeProfile?.(profile)) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
        account = {uid:targetUid, authEmail:auth.email};
        loginMethod = 'firebase-native';
      }
      if (!account || identity.uid !== account.uid) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
      result = {status:200, body:{ok:true, protocol:'gmail-password-v1', loginMethod, uid:account.uid, authEmail:account.authEmail}};
      return result;
    } catch {
      // Do not log passwords, provider error objects, user records or identifiers.
      return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
    } finally {
      // Reduce inexpensive timing differences; this is not the abuse boundary.
      // The atomic database budget applies before identity/provider lookups.
      await deps.finishDelay(start);
    }
  };
}
