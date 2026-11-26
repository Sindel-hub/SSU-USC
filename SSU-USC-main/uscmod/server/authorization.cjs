"use strict";
const { active } = require("./officer-term.cjs");
const { ServiceError } = require("./settings.cjs");
function createAuthorization({ db, clock = Date.now }) {
  async function requireActiveRole(request, roles, { useOfficerProfile = false } = {}) {
    const auth = request.auth;
    if (!auth?.uid) throw new ServiceError("unauthenticated", "Please sign in first.");
    let role = String(auth.token.role || "").toLowerCase();
    if (useOfficerProfile && roles.includes("officer") && role !== "admin" && !request.trustedProfile) {
      request.trustedProfile = (await db.doc(`users/${auth.uid}`).get()).data();
    }
    if (useOfficerProfile && roles.includes("officer") && role !== "admin" && request.trustedProfile?.role === "officer") role = "officer";
    if (!roles.includes(role)) throw new ServiceError("permission-denied", "This account is not authorized for this action.");
    if (role === "admin" && auth.token.email_verified !== true) throw new ServiceError("failed-precondition", "Administrator email verification is required.");
    if (!request.trustedProfile) {
      const snap = await db.doc(`users/${auth.uid}`).get();
      if (!snap.exists) throw new ServiceError("permission-denied", "Trusted account profile not found.");
      request.trustedProfile = snap.data();
    }
    const profile = request.trustedProfile;
    if (profile.role !== role || profile.accountStatus !== "approved" || profile.isActive === false || profile.accountRemoved === true || profile.accountRemovalPending === true || (role !== "admin" && profile.studentStanding && profile.studentStanding !== "active")) throw new ServiceError("permission-denied", "This account is inactive, unapproved, or its role has changed.");
    if (role === "officer" && profile.officerAssignmentId) {
      const a = (await db.doc(`officer_assignments/${profile.officerAssignmentId}`).get()).data();
      if (!active(a, clock()) || a.officerUid !== auth.uid) throw new ServiceError("permission-denied", "Your officer assignment is not active. Contact the administrator for turnover.");
    }
    return profile;
  }
  function requireRecentAuth(request, message = "Sign in again before changing student records.") {
    const authTime = Number(request.auth?.token?.auth_time);
    const now = Math.floor(clock() / 1000);
    if (!Number.isFinite(authTime) || authTime <= 0 || authTime > now + 60 || now - authTime > 1800) throw new ServiceError("failed-precondition", message);
  }
  async function requireOfficerPermission(request, permission) {
    const profile = await requireActiveRole(request, ["officer", "admin"], { useOfficerProfile: true });
    if (request.auth.token.role === "admin") return profile;
    const { effectiveOfficerPermissions } = await import("../shared/officer-permissions.js");
    if (!effectiveOfficerPermissions(profile, { legacyFullAccess: false }).includes(permission)) throw new ServiceError("permission-denied", "Your assigned office does not have this permission.");
    return profile;
  }
  return { requireActiveRole, requireRecentAuth, requireOfficerPermission };
}
module.exports = { createAuthorization };
