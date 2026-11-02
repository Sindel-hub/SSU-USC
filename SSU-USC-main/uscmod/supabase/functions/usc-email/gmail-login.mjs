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
    if (owner && owner.uid !== uid) return null;
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
      const verified = mapping?.firebase_uid && mapping.verified_at
        && mapping.requested_email === email && mapping.verified_email === email;
      // Keep unauthenticated work similar for present and absent mappings. Check
      // the profile and Gmail ownership only after Firebase proves the password.
      const user = await deps.authUser(verified ? String(mapping.firebase_uid) : 'unavailable-gmail-login');
      const candidate = verified && user?.uid === String(mapping.firebase_uid) && !user.disabled && user.email;
      const identity = await deps.passwordIdentity(candidate || 'unavailable@invalid.invalid', password);
      if (!candidate || identity?.uid !== String(mapping.firebase_uid)) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
      // Re-read the authoritative mapping after proof so a changed/revoked Gmail
      // record is not accepted from the pre-password snapshot.
      const account = await resolveVerifiedGmailAccount(deps, input.email);
      if (!account || identity.uid !== account.uid) return {status:401, body:{ok:false, message:GMAIL_LOGIN_FAILURE}};
      result = {status:200, body:{ok:true, protocol:'gmail-password-v1', uid:account.uid, authEmail:account.authEmail}};
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
