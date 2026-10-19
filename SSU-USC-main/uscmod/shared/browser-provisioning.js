import { auth, db, firebaseConfig } from "../firebase/firebase-config.js";
import { enrollmentStatusForStanding, isActiveStudentStanding, normalizeStudentStanding, studentStandingLabel } from "./student-standing.js";
import { permissionsForOfficerPosition } from "./officer-permissions.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STUDENT_ID_REGEX = /^\d{6}$/;

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}
function normalizeEmail(value) {
  return clean(value, 200).toLowerCase();
}
function normalizeStudentId(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}
function normalizeFullName(value) {
  return clean(value, 120)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function fullNameClaimId(value) {
  const normalized = normalizeFullName(value);
  if (!normalized) throw new Error("Enter the account holder's full name.");
  return sha256Hex(normalized);
}
async function existingMasterlistNameMatch(fullName) {
  const normalized = normalizeFullName(fullName);
  if (!normalized) return null;
  const snapshot = await getDocs(collection(db, "student_masterlist"));
  for (const item of snapshot.docs) {
    const data = item.data() || {};
    if (normalizeFullName(data.fullName) === normalized) {
      return { studentId: clean(data.studentId || item.id, 30), fullName: clean(data.fullName, 120) };
    }
  }
  return null;
}
async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomIndex(length) {
  const max = Math.floor(0x100000000 / length) * length;
  const view = new Uint32Array(1);
  do crypto.getRandomValues(view); while (view[0] >= max);
  return view[0] % length;
}
function pick(chars) {
  return chars[randomIndex(chars.length)];
}
export function generateTemporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + numbers + symbols;
  const chars = [pick(upper), pick(lower), pick(numbers), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function requireAdmin() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as System Administrator first.");
  const token = await user.getIdTokenResult(true);
  if (String(token.claims.role || "").toLowerCase() !== "admin") {
    throw new Error("System Administrator access is required.");
  }
  // The trusted admin custom claim + approved Firestore admin profile are the authority.
  // Firebase email verification remains optional for recovery/contact purposes.
  const snap = await getDoc(doc(db, "users", user.uid));
  const profile = snap.exists() ? snap.data() : null;
  if (!profile || profile.isActive === false || String(profile.accountStatus || "").toLowerCase() !== "approved") {
    throw new Error("The System Administrator account is not active and approved.");
  }
  return { user, profile };
}

export async function provisionStudentAccount(input = {}) {
  const { user: adminUser } = await requireAdmin();
  const studentId = normalizeStudentId(input.studentId);
  const institutionalEmail = normalizeEmail(input.institutionalEmail || input.email) || null;
  const authEmail = institutionalEmail || `${studentId}@student.ssu-usc.local`;
  const fullName = clean(input.fullName || input.name, 120);
  const program = clean(input.program, 160);
  const college = clean(input.college, 160);
  const yearLevel = clean(input.yearLevel, 40);
  const studentStanding = normalizeStudentStanding(input.studentStanding, input.enrollmentStatus);
  const enrollmentStatus = enrollmentStatusForStanding(studentStanding);
  const standingActive = isActiveStudentStanding(studentStanding, enrollmentStatus);
  const eligible = input.eligible === true && standingActive;

  if (!STUDENT_ID_REGEX.test(studentId)) throw new Error("Student ID must contain exactly 6 digits.");
  if (institutionalEmail && (!EMAIL_REGEX.test(institutionalEmail) || /@(?:student\.)?ssu-usc\.local$/.test(institutionalEmail))) throw new Error("Enter a valid institutional email address.");
  if (fullName.length < 2) throw new Error("Enter the student's full name.");
  if (!college || !program) throw new Error("Select the student's college/campus and program.");
  if (!yearLevel) throw new Error("Select the student's year level.");

  const claimRef = doc(db, "student_id_claims", studentId);
  const nameClaimId = await fullNameClaimId(fullName);
  const nameClaimRef = doc(db, "student_name_claims", nameClaimId);
  let existingClaim;
  let existingNameClaim;
  try {
    [existingClaim, existingNameClaim] = await Promise.all([getDoc(claimRef), getDoc(nameClaimRef)]);
  } catch (error) {
    if (error?.code === "permission-denied") {
      throw new Error("Student account creation is blocked by Firestore permissions. Publish the firestore.rules included with this project in Firebase Console, then sign out and sign back in as System Administrator.");
    }
    throw error;
  }
  if (existingClaim.exists()) throw new Error("This Student ID is already assigned to a school account. Duplicate Student IDs are not allowed.");
  if (existingNameClaim.exists()) throw new Error("This full name is already assigned to a school account. Duplicate account names are not allowed.");
  if (institutionalEmail) {
    const emailAlias = await getDoc(doc(db, "login_aliases", `email_${await sha256Hex(institutionalEmail)}`));
    if (emailAlias.exists()) throw new Error("That institutional email already has an account. Use the existing account instead of creating a duplicate.");
  }
  const existingAccount = await getDoc(doc(db, "school_accounts", studentId));
  const existingStudent = await getDoc(doc(db, "student_masterlist", studentId));
  if (existingAccount.exists() || existingStudent.exists()) throw new Error("This Student ID already has an account record. Duplicate Student IDs are not allowed.");
  const existingNameRecord = await existingMasterlistNameMatch(fullName);
  if (existingNameRecord) {
    throw new Error(`This full name is already used by Student ID ${existingNameRecord.studentId || "an existing account"}. Duplicate account names are not allowed.`);
  }

  // A secondary Firebase app keeps the System Administrator signed in on the
  // primary app while Firebase Authentication creates the student's account.
  const appName = `usc-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const provisioningApp = initializeApp(firebaseConfig, appName);
  const provisioningAuth = getAuth(provisioningApp);
  const temporaryPassword = generateTemporaryPassword();
  let credential = null;
  let committed = false;

  try {
    credential = await createUserWithEmailAndPassword(provisioningAuth, authEmail, temporaryPassword);
    await updateProfile(credential.user, { displayName: fullName });
    const uid = credential.user.uid;
    const now = serverTimestamp();
    const batch = writeBatch(db);

    batch.set(doc(db, "users", uid), {
      uid,
      studentId,
      fullName,
      institutionalEmail,
      email: institutionalEmail || "",
      institutionalEmailVerified: false,
      authEmail,
      program,
      college,
      yearLevel,
      studentStanding,
      enrollmentStatus,
      role: "student",
      accountStatus: "approved",
      isActive: standingActive,
      schoolProvisioned: true,
      isVerifiedStudent: eligible,
      candidacyApproved: false,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      updatedAtMs: Date.now()
    });

    batch.set(claimRef, {
      studentId,
      uid,
      institutionalEmail,
      authEmail,
      createdBy: adminUser.uid,
      updatedAt: now
    });

    batch.set(nameClaimRef, {
      nameKey: nameClaimId,
      normalizedName: normalizeFullName(fullName),
      fullName,
      studentId,
      uid,
      accountRole: "student",
      createdBy: adminUser.uid,
      updatedAt: now
    });

    batch.set(doc(db, "school_accounts", studentId), {
      studentId,
      uid,
      institutionalEmail,
      authEmail,
      active: standingActive,
      studentStanding,
      updatedAt: now
    });

    batch.set(doc(db, "student_masterlist", studentId), {
      studentId,
      fullName,
      institutionalEmail,
      program,
      college,
      yearLevel,
      studentStanding,
      enrollmentStatus,
      eligible: standingActive,
      verificationMethod: "school_admin_browser",
      verifiedBy: adminUser.uid,
      verifiedAt: now,
      updatedAt: now
    });

    batch.set(doc(db, "login_aliases", `id_${studentId}`), {
      authEmail,
      kind: "studentId",
      uid,
      updatedAt: now
    });
    if (institutionalEmail) batch.set(doc(db, "login_aliases", `email_${await sha256Hex(institutionalEmail)}`), {
      authEmail, uid, verified: false, kind: "institutionalEmail", updatedAt: now
    });

    batch.set(doc(collection(db, "audit_logs")), {
      actorUid: adminUser.uid,
      actorEmail: adminUser.email || "",
      action: "STUDENT_ACCOUNT_CREATED",
      targetUid: uid,
      targetStudentId: studentId,
      source: "browser-admin-runtime",
      createdAt: now
    });

    try {
      const pointer = await getDoc(doc(db, "election_config", "current"));
      const electionId = pointer.exists() ? clean(pointer.data()?.electionId, 160) : "";
      if (electionId) {
        batch.set(doc(db, "elections", electionId, "voterRoster", studentId), {
          studentId,
          fullName,
          institutionalEmail,
          program,
          college,
          yearLevel,
          studentStanding,
          enrollmentStatus,
          eligible: standingActive,
          verificationMethod: "school_admin_browser",
          verifiedBy: adminUser.uid,
          verifiedAt: now
        }, { merge: true });
      }
    } catch (error) {
      console.warn("No current election roster was updated:", error);
    }

    await batch.commit();
    committed = true;

    return {
      ok: true,
      created: true,
      processed: 1,
      credential: {
        uid,
        studentId,
        fullName,
        institutionalEmail,
        college,
        program,
        yearLevel,
        studentStanding,
        studentStandingLabel: studentStandingLabel(studentStanding),
        temporaryPassword
      }
    };
  } catch (error) {
    if (credential?.user && !committed) {
      try { await deleteUser(credential.user); } catch (rollbackError) { console.warn("Auth rollback failed:", rollbackError); }
    }
    if (error?.code === "auth/email-already-in-use") {
      if (!institutionalEmail) throw new Error("This Student ID already has a Firebase account. Use the existing account instead of creating a duplicate.");
      throw new Error("That institutional email already has an account. Use Password Reset instead of creating a duplicate account.");
    }
    if (error?.code === "auth/weak-password") throw new Error("The temporary password generator produced an invalid password. Please retry.");
    if (error?.code === "auth/operation-not-allowed") throw new Error("Enable Email/Password sign-in in Firebase Authentication first.");
    if (error?.code === "permission-denied") throw new Error("Firestore blocked this account creation. Publish the included firestore.rules in Firebase Console and sign in again as System Administrator.");
    throw error;
  } finally {
    try { await signOut(provisioningAuth); } catch {}
    try { await deleteApp(provisioningApp); } catch {}
  }
}


const USC_OFFICER_POSITIONS = Object.freeze([
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "Public Relations Officer (PRO)",
  "Business Manager",
  "Sgt. at Arms",
  "Department Representative"
]);

export async function provisionOfficerAccount(input = {}) {
  const { user: adminUser } = await requireAdmin();
  const studentId = normalizeStudentId(input.studentId);
  const institutionalEmail = normalizeEmail(input.institutionalEmail || input.email) || null;
  const authEmail = institutionalEmail || `${studentId}@student.ssu-usc.local`;
  const fullName = clean(input.fullName || input.name, 120);
  const program = clean(input.program, 160);
  const college = clean(input.college, 160);
  const yearLevel = clean(input.yearLevel, 40);
  const studentStanding = normalizeStudentStanding(input.studentStanding, input.enrollmentStatus);
  const enrollmentStatus = enrollmentStatusForStanding(studentStanding);
  const standingActive = isActiveStudentStanding(studentStanding, enrollmentStatus);
  const officePosition = clean(input.officePosition, 120);
  const roleEffectiveDate = clean(input.roleEffectiveDate || new Date().toISOString().slice(0, 10), 40);
  const eligible = input.eligible !== false && standingActive;
  const positionPermissions = permissionsForOfficerPosition(officePosition);

  if (!STUDENT_ID_REGEX.test(studentId)) throw new Error("Student ID must contain exactly 6 digits.");
  if (institutionalEmail && (!EMAIL_REGEX.test(institutionalEmail) || /@(?:student\.)?ssu-usc\.local$/.test(institutionalEmail))) throw new Error("Enter a valid institutional email address.");
  if (fullName.length < 2) throw new Error("Enter the officer's full name.");
  if (!college || !program) throw new Error("Select the officer's college/campus and program.");
  if (!yearLevel) throw new Error("Select the officer's year level.");
  if (!USC_OFFICER_POSITIONS.includes(officePosition)) throw new Error("Select a valid USC officer position.");

  const claimRef = doc(db, "student_id_claims", studentId);
  const nameClaimId = await fullNameClaimId(fullName);
  const nameClaimRef = doc(db, "student_name_claims", nameClaimId);
  let existingClaim;
  let existingNameClaim;
  try {
    [existingClaim, existingNameClaim] = await Promise.all([getDoc(claimRef), getDoc(nameClaimRef)]);
  } catch (error) {
    if (error?.code === "permission-denied") {
      throw new Error("Officer account creation is blocked by Firestore permissions. Publish the firestore.rules included with this project in Firebase Console, then sign out and sign back in as System Administrator.");
    }
    throw error;
  }
  if (existingClaim.exists()) throw new Error("This Student ID is already assigned to a school account. Duplicate Student IDs are not allowed.");
  if (existingNameClaim.exists()) throw new Error("This full name is already assigned to a school account. Duplicate account names are not allowed.");
  if (institutionalEmail) {
    const emailAlias = await getDoc(doc(db, "login_aliases", `email_${await sha256Hex(institutionalEmail)}`));
    if (emailAlias.exists()) throw new Error("That institutional email already has an account. Use the existing account instead of creating a duplicate.");
  }
  const existingAccount = await getDoc(doc(db, "school_accounts", studentId));
  const existingStudent = await getDoc(doc(db, "student_masterlist", studentId));
  if (existingAccount.exists() || existingStudent.exists()) throw new Error("This Student ID already has an account record. Duplicate Student IDs are not allowed.");
  const existingNameRecord = await existingMasterlistNameMatch(fullName);
  if (existingNameRecord) {
    throw new Error(`This full name is already used by Student ID ${existingNameRecord.studentId || "an existing account"}. Duplicate account names are not allowed.`);
  }

  const appName = `usc-officer-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const provisioningApp = initializeApp(firebaseConfig, appName);
  const provisioningAuth = getAuth(provisioningApp);
  const temporaryPassword = generateTemporaryPassword();
  let credential = null;
  let committed = false;
  let verificationEmailSent = false;

  try {
    credential = await createUserWithEmailAndPassword(provisioningAuth, authEmail, temporaryPassword);
    await updateProfile(credential.user, { displayName: fullName });
    if (institutionalEmail) {
      try {
        await sendEmailVerification(credential.user);
        verificationEmailSent = true;
      } catch (emailError) {
        console.warn("Firebase verification email was not sent:", emailError?.code || emailError);
      }
    }

    const uid = credential.user.uid;
    const now = serverTimestamp();
    const batch = writeBatch(db);

    batch.set(doc(db, "users", uid), {
      uid,
      studentId,
      fullName,
      institutionalEmail,
      email: institutionalEmail || "",
      institutionalEmailVerified: false,
      authEmail,
      program,
      college,
      yearLevel,
      studentStanding,
      enrollmentStatus,
      role: "officer",
      officePosition,
      officerPermissions: positionPermissions,
      officerPermissionSource: "position-default",
      roleEffectiveDate,
      accountStatus: "approved",
      isActive: standingActive,
      schoolProvisioned: true,
      isVerifiedStudent: eligible,
      candidacyApproved: false,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      updatedAtMs: Date.now()
    });

    batch.set(claimRef, {
      studentId,
      uid,
      institutionalEmail,
      authEmail,
      createdBy: adminUser.uid,
      accountRole: "officer",
      updatedAt: now
    });

    batch.set(nameClaimRef, {
      nameKey: nameClaimId,
      normalizedName: normalizeFullName(fullName),
      fullName,
      studentId,
      uid,
      accountRole: "officer",
      createdBy: adminUser.uid,
      updatedAt: now
    });

    batch.set(doc(db, "school_accounts", studentId), {
      studentId,
      uid,
      institutionalEmail,
      authEmail,
      role: "officer",
      active: standingActive,
      studentStanding,
      updatedAt: now
    });

    batch.set(doc(db, "student_masterlist", studentId), {
      studentId,
      fullName,
      institutionalEmail,
      program,
      college,
      yearLevel,
      studentStanding,
      enrollmentStatus,
      eligible,
      systemRole: "officer",
      officePosition,
      verificationMethod: "school_admin_browser",
      verifiedBy: adminUser.uid,
      verifiedAt: now,
      updatedAt: now
    });

    batch.set(doc(db, "login_aliases", `id_${studentId}`), {
      authEmail,
      kind: "studentId",
      uid,
      updatedAt: now
    });
    if (institutionalEmail) batch.set(doc(db, "login_aliases", `email_${await sha256Hex(institutionalEmail)}`), {
      authEmail, uid, verified: false, kind: "institutionalEmail", updatedAt: now
    });

    batch.set(doc(collection(db, "audit_logs")), {
      actorUid: adminUser.uid,
      actorEmail: adminUser.email || "",
      action: "OFFICER_ACCOUNT_CREATED",
      targetUid: uid,
      targetStudentId: studentId,
      officePosition,
      source: "browser-admin-runtime",
      createdAt: now
    });

    try {
      const pointer = await getDoc(doc(db, "election_config", "current"));
      const electionId = pointer.exists() ? clean(pointer.data()?.electionId, 160) : "";
      if (electionId) {
        batch.set(doc(db, "elections", electionId, "voterRoster", studentId), {
          studentId,
          fullName,
          institutionalEmail,
          program,
          college,
          yearLevel,
          studentStanding,
          enrollmentStatus,
          eligible: standingActive,
          verificationMethod: "school_admin_browser",
          verifiedBy: adminUser.uid,
          verifiedAt: now
        }, { merge: true });
      }
    } catch (error) {
      console.warn("No current election roster was updated for the officer:", error);
    }

    await batch.commit();
    committed = true;

    return {
      ok: true,
      created: true,
      processed: 1,
      verificationEmailSent,
      credential: {
        uid,
        studentId,
        fullName,
        institutionalEmail,
        college,
        program,
        yearLevel,
        studentStanding,
        studentStandingLabel: studentStandingLabel(studentStanding),
        officePosition,
        roleEffectiveDate,
        temporaryPassword,
        verificationEmailSent
      }
    };
  } catch (error) {
    if (credential?.user && !committed) {
      try { await deleteUser(credential.user); } catch (rollbackError) { console.warn("Officer Auth rollback failed:", rollbackError); }
    }
    if (error?.code === "auth/email-already-in-use") {
      if (!institutionalEmail) throw new Error("This Student ID already has a Firebase account. Use the existing account instead of creating a duplicate.");
      throw new Error("That institutional email already has an account. Use the User Directory to promote the existing account instead of creating a duplicate.");
    }
    if (error?.code === "auth/weak-password") throw new Error("The temporary password generator produced an invalid password. Please retry.");
    if (error?.code === "auth/operation-not-allowed") throw new Error("Enable Email/Password sign-in in Firebase Authentication first.");
    if (error?.code === "permission-denied") throw new Error("Firestore blocked this officer account creation. Publish the included firestore.rules in Firebase Console and sign in again as System Administrator.");
    throw error;
  } finally {
    try { await signOut(provisioningAuth); } catch {}
    try { await deleteApp(provisioningApp); } catch {}
  }
}

export async function sendStudentPasswordReset(identifier) {
  await requireAdmin();
  const raw = clean(identifier, 200);
  let email = "";
  if (STUDENT_ID_REGEX.test(raw)) {
    const alias = await getDoc(doc(db, "login_aliases", `id_${raw}`));
    email = alias.exists() ? normalizeEmail(alias.data()?.authEmail) : "";
  } else if (EMAIL_REGEX.test(raw)) {
    const normalized = normalizeEmail(raw);
    const alias = await getDoc(doc(db, "login_aliases", `email_${await sha256Hex(normalized)}`));
    email = alias.exists() ? normalizeEmail(alias.data()?.authEmail) : normalized;
  }
  if (!email) throw new Error("Student account not found. Check the Student ID or institutional email.");
  if (email.endsWith("@student.ssu-usc.local")) {
    throw new Error("This account has no email inbox. Open User Directory and choose Reset password to issue a temporary password securely. Do not create another account.");
  }
  await sendPasswordResetEmail(auth, email);
  return { ok: true, email };
}

export async function provisionStudentAccounts(rows = []) {
  const credentials = [];
  let processed = 0;
  let created = 0;
  const failures = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      const result = await provisionStudentAccount(row);
      processed += 1;
      if (result.created) {
        created += 1;
        credentials.push(result.credential);
      }
    } catch (error) {
      processed += 1;
      failures.push({ studentId: normalizeStudentId(row?.studentId), error: error.message || "Unable to create account." });
    }
  }
  return { ok: failures.length === 0, processed, created, credentials, failures };
}

export const sendSchoolPasswordReset = sendStudentPasswordReset;
