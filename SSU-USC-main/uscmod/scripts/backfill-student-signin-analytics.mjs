import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });

const auth = getAuth();
const db = getFirestore();

const profileSnapshot = await db.collection("users").where("role", "==", "student").get();
const profiles = profileSnapshot.docs
  .map((docSnap) => ({ uid: docSnap.id, ...(docSnap.data() || {}) }))
  .filter((profile) => String(profile.college || profile.department || "").trim());

let created = 0;
let restored = 0;
let skipped = 0;

for (let offset = 0; offset < profiles.length; offset += 100) {
  const chunk = profiles.slice(offset, offset + 100);
  const authResult = await auth.getUsers(chunk.map((profile) => ({ uid: profile.uid })));
  const authByUid = new Map(authResult.users.map((user) => [user.uid, user]));

  for (const profile of chunk) {
    const statsRef = db.doc(`student_signin_stats/${profile.uid}`);
    const statsSnap = await statsRef.get();
    if (statsSnap.exists && Number(statsSnap.get("signInCount") || 0) > 0) {
      skipped += 1;
      continue;
    }

    const authUser = authByUid.get(profile.uid);
    const lastSignInDate = authUser?.metadata?.lastSignInTime
      ? new Date(authUser.metadata.lastSignInTime)
      : null;
    const creationDate = authUser?.metadata?.creationTime
      ? new Date(authUser.metadata.creationTime)
      : null;
    const validCreation = creationDate && !Number.isNaN(creationDate.getTime()) ? creationDate : null;
    const profileLastLoginMs = Math.max(0, Number(profile.lastLoginAtMs || profile.lastLoginAt?.toMillis?.() || 0));
    const authLastSignIn = lastSignInDate && !Number.isNaN(lastSignInDate.getTime()) ? lastSignInDate : null;
    // Browser provisioning signs the newly-created account into a secondary Auth app,
    // so Firebase Auth's creation-time sign-in is not evidence that the student visited
    // the portal. Only restore Auth history when it is clearly later than creation.
    const authLooksLikeRealLaterLogin = Boolean(
      authLastSignIn
      && validCreation
      && authLastSignIn.getTime() - validCreation.getTime() > 2 * 60 * 1000
    );
    const validLastSignIn = profileLastLoginMs
      ? new Date(profileLastLoginMs)
      : (authLooksLikeRealLaterLogin ? authLastSignIn : null);

    const patch = {
      studentUid: profile.uid,
      department: String(profile.college || profile.department || "").trim(),
      program: String(profile.program || "").trim(),
      signInCount: validLastSignIn ? 1 : 0,
      firstSignInAt: validLastSignIn ? Timestamp.fromDate(validLastSignIn) : null,
      lastSignInAt: validLastSignIn ? Timestamp.fromDate(validLastSignIn) : null,
      accountCreatedAtMs: validCreation ? validCreation.getTime() : Number(profile.createdAtMs || profile.createdAt?.toMillis?.() || 0),
      legacyBackfill: true,
      historicalSource: validLastSignIn ? (profileLastLoginMs ? "profile-last-login" : "firebase-auth-later-login") : "account-baseline",
      backfilledAt: FieldValue.serverTimestamp()
    };

    await statsRef.set(patch, { merge: true });
    created += statsSnap.exists ? 0 : 1;
    if (validLastSignIn) restored += 1;
  }
}

console.log(`Student analytics backfill complete. Accounts processed: ${profiles.length}; new baseline records: ${created}; historical last-sign-ins restored: ${restored}; already tracked: ${skipped}.`);
