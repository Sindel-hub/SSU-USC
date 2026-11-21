"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { ServiceError } = require("./settings.cjs");
const { DEPARTMENTS } = require("../functions/needs-assessment-model.js");
const POSITIONS = Object.freeze({
  President: ["dashboard.view", "organization.view", "complaints.view", "complaints.review", "complaints.classify", "complaints.feedback", "complaints.status", "complaints.report", "bulletin.manage", "events.manage", "programs.manage", "reports.generate"],
  Treasurer: ["dashboard.view", "organization.view", "reports.generate"],
  "Public Information Officer": ["dashboard.view", "organization.view", "bulletin.manage", "events.manage", "programs.manage"],
  "USC Representative": ["dashboard.view", "organization.view", "complaints.view", "complaints.review"]
});
const fail = (code, message) => { throw new ServiceError(code, message); };
function text(value, name, max = 120, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("invalid-argument", `Invalid ${name}.`);
  return value.trim();
}
function id(value) { const v = text(value, "record ID", 128); if (!/^[a-zA-Z0-9_-]+$/.test(v)) fail("invalid-argument", "Invalid record ID."); return v; }
function active(a, now) { return a?.status === "active" && a.startsAtMs <= now && a.endsAtMs > now; }
const slot = (position, department) => createHash("sha256").update(`${position}:${department}`).digest("hex");
function createOfficerHistory({ db, adminAuth, requireActiveRole, requireRecentAuth, clock = Date.now }) {
  const assignments = db.collection("officer_assignments"), records = db.collection("officer_records");
  async function admin(request) { await requireActiveRole(request, ["admin"]); requireRecentAuth(request); }
  // Read the profile AND assignment inside the mutation transaction. A completed
  // or expired assignment cannot race a cached browser/profile authorization.
  async function context(tx, request, permission) {
    const profile = (await tx.get(db.doc(`users/${request.auth.uid}`))).data();
    if (!profile || profile.isActive === false || profile.accountStatus !== "approved" || profile.accountRemoved || profile.accountRemovalPending || (profile.studentStanding && profile.studentStanding !== "active")) fail("permission-denied", "This account cannot perform officer activities.");
    if (profile.role === "admin" && request.auth.token.role === "admin") return null;
    if (profile.role !== "officer") fail("permission-denied", "An active officer assignment is required.");
    if (!profile.officerAssignmentId) return null; // Unmigrated records are never attributed to an invented term.
    const a = (await tx.get(assignments.doc(id(profile.officerAssignmentId)))).data();
    if (!active(a, clock()) || a.officerUid !== request.auth.uid || a.position !== profile.officePosition || (permission && !a.permissions.includes(permission))) fail("permission-denied", "The officer assignment has ended, is not active yet, or does not permit this action.");
    return { ...a, assignmentId: profile.officerAssignmentId };
  }
  function append(tx, a, { module, action, status, recordId, snapshot = null }) {
    if (!a) return;
    const ref = records.doc();
    // Metadata is generated from the trusted assignment, never from browser input.
    tx.create(ref, { assignmentId: a.assignmentId, officerUid: a.officerUid, officerName: a.officerName, position: a.position, department: a.department, administration: a.administration, module, action, status, recordId, createdAtMs: clock(), snapshot });
    return ref.id;
  }
  async function roleIndexes(tx, profile, uid) {
    const sid = profile?.studentId;
    if (typeof sid !== "string" || !/^[0-9]{1,64}$/.test(sid)) return [];
    const refs = [db.doc(`school_accounts/${sid}`), db.doc(`student_masterlist/${sid}`)];
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    return snapshots.flatMap((snap, i) => snap.exists && (!snap.data().uid || snap.data().uid === uid) ? [{ ref: refs[i], school: i === 0 }] : []);
  }
  function updateRoleIndexes(tx, indexes, role, position) {
    for (const { ref, school } of indexes) tx.update(ref, school ? { role } : { systemRole: role, officePosition: position });
  }
  async function access(request, assignmentId) {
    const p = await requireActiveRole(request, ["student", "officer", "admin"]);
    const snap = await assignments.doc(id(assignmentId)).get();
    if (!snap.exists) fail("not-found", "Assignment not found.");
    const a = { id: snap.id, ...snap.data() };
    if (p.role === "admin" || a.officerUid === request.auth.uid) return a;
    if (p.role === "officer" && p.officerAssignmentId) {
      const current = (await assignments.doc(id(p.officerAssignmentId)).get()).data();
      if (active(current, clock()) && current.officerUid === request.auth.uid && current.position === a.position && current.department === a.department) return a;
    }
    fail("permission-denied", "Only this officer, an active successor in the same office, or an administrator may view these records.");
  }
  async function sync(a, assignmentId) {
    // Profile controls revoke access immediately; claim synchronization can be
    // retried separately after an Auth outage. Never replace other custom claims.
    try {
      const user = await adminAuth.getUser(a.officerUid);
      const p = (await db.doc(`users/${a.officerUid}`).get()).data();
      if (!p || !["student", "officer"].includes(p.role)) throw Error("Account role requires authorized reconciliation.");
      const role = p.role;
      await adminAuth.setCustomUserClaims(a.officerUid, { ...user.customClaims, role });
      await adminAuth.revokeRefreshTokens(a.officerUid);
      await assignments.doc(assignmentId).update({ authSyncPending: false });
      return false;
    } catch { return true; }
  }
  async function page(collection, request, filter) {
    let q = collection;
    for (const [key, value] of Object.entries(filter)) q = q.where(key, "==", value);
    q = q.orderBy("__name__").limit(51);
    if (request.data?.after) q = q.startAfter(id(request.data.after));
    const docs = (await q.get()).docs;
    return { items: docs.slice(0, 50).map(d => ({ id: d.id, ...d.data() })), next: docs.length > 50 ? docs[49].id : null };
  }
  return {
    context, append, access,
    handlers: {
      async officerCandidateFind(request) {
        await admin(request);
        const studentId = text(request.data?.studentId, "Student ID", 64);
        if (!/^[0-9]+$/.test(studentId)) fail("invalid-argument", "Use an exact Student ID.");
        const matches = (await db.collection("users").where("studentId", "==", studentId).limit(2).get()).docs;
        if (matches.length !== 1) fail("failed-precondition", "No unique student account found. Resolve missing or duplicate accounts in User Directory first.");
        const p = matches[0].data();
        if (!["student", "officer"].includes(p.role)) fail("permission-denied", "This account cannot be assigned to an officer position.");
        return { uid: matches[0].id, fullName: p.fullName || p.displayName, studentId, role: p.role };
      },
      async officerAssignmentManage(request) {
        await admin(request);
        const d = request.data || {};
        if (d.action === "assign") {
          const position = text(d.position, "position");
          if (!Object.hasOwn(POSITIONS, position)) fail("invalid-argument", "Choose one of the four capstone positions.");
          const department = position === "USC Representative" ? text(d.department, "represented department", 120) : "University-wide";
          if (position === "USC Representative" && !DEPARTMENTS.includes(department)) fail("invalid-argument", "Select a recognized SSU department.");
          const administration = text(d.administration, "administration period", 80);
          const reason = text(d.authorization, "appointment authorization reference", 240);
          const uid = id(d.officerUid), startsAtMs = Number(d.startsAtMs), endsAtMs = Number(d.endsAtMs);
          if (!Number.isSafeInteger(startsAtMs) || !Number.isSafeInteger(endsAtMs) || startsAtMs > clock() || endsAtMs <= clock() || endsAtMs <= startsAtMs || endsAtMs - startsAtMs > 4 * 366 * 86400000) fail("invalid-argument", "Choose a current term ending in the future (at most four years).");
          const permissions = d.permissions || POSITIONS[position];
          if (!Array.isArray(permissions) || !permissions.includes("dashboard.view") || permissions.some(v => !POSITIONS[position].includes(v)) || new Set(permissions).size !== permissions.length) fail("invalid-argument", "Permissions must be a subset of the selected office responsibilities.");
          const assignmentId = id(d.assignmentId || randomUUID());
          const ref = assignments.doc(assignmentId), userRef = db.doc(`users/${uid}`), lockRef = db.doc(`officer_office_slots/${slot(position, department)}`);
          let a;
          await db.runTransaction(async tx => {
            const [existing, person, lock] = await Promise.all([tx.get(ref), tx.get(userRef), tx.get(lockRef)]);
            if (existing.exists) fail("already-exists", "Assignment already exists. Reload it; do not submit another assignment.");
            const p = person.data();
            if (!p || !["student", "officer"].includes(p.role) || p.isActive === false || p.accountStatus !== "approved" || p.accountRemoved || p.accountRemovalPending || (p.studentStanding && p.studentStanding !== "active")) fail("failed-precondition", "Choose an approved, active student account.");
            if (p.officerAssignmentId) {
              const prior = (await tx.get(assignments.doc(id(p.officerAssignmentId)))).data();
              if (prior?.status !== "completed") fail("failed-precondition", "Complete this student's previous assignment first, including expired terms.");
            }
            if (lock.data()?.assignmentId) {
              const prior = (await tx.get(assignments.doc(lock.data().assignmentId))).data();
              if (prior?.status !== "completed") fail("failed-precondition", "Complete the outgoing officer's assignment before turnover.");
            }
            const indexes = await roleIndexes(tx, p, uid);
            a = { officerUid: uid, officerName: text(p.fullName || p.displayName, "officer name"), position, department, administration, startsAtMs, endsAtMs, permissions, status: "active", authorization: reason, appointedBy: request.auth.uid, createdAtMs: clock(), authSyncPending: true };
            tx.create(ref, a);
            updateRoleIndexes(tx, indexes, "officer", position);
            tx.set(lockRef, { assignmentId });
            tx.update(userRef, { role: "officer", officePosition: position, officerAssignmentId: assignmentId, officerPermissions: permissions, officerPermissionSource: "custom", updatedAt: new Date(clock()) });
          });
          return { id: assignmentId, authSyncPending: await sync(a, assignmentId) };
        }
        if (!["complete", "sync"].includes(d.action)) fail("invalid-argument", "Unknown assignment action.");
        const assignmentId = id(d.assignmentId), ref = assignments.doc(assignmentId);
        let a;
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) fail("not-found", "Assignment not found.");
          a = snap.data();
          const userRef = db.doc(`users/${a.officerUid}`), person = await tx.get(userRef);
          if (d.action === "sync") return;
          if (a.status === "completed") return;
          const completionReason = text(d.reason, "turnover reason/reference", 240);
          const indexes = await roleIndexes(tx, person.data(), a.officerUid);
          tx.update(ref, { status: "completed", completedAtMs: clock(), completedBy: request.auth.uid, completionReason, authSyncPending: true });
          if (person.data()?.officerAssignmentId === assignmentId) { updateRoleIndexes(tx, indexes, "student", ""); tx.update(userRef, { role: "student", officePosition: "", officerPermissions: [], officerPermissionSource: "", updatedAt: new Date(clock()) }); }
        });
        return { id: assignmentId, authSyncPending: await sync(a, assignmentId) };
      },
      async officerAssignments(request) {
        const p = await requireActiveRole(request, ["student", "officer", "admin"]);
        let filter = p.role === "admin" ? {} : { officerUid: request.auth.uid };
        if (request.data?.assignmentId) {
          const a = await access(request, request.data.assignmentId);
          const { authorization, appointedBy, completionReason, completedBy, ...safe } = a;
          return { items: [p.role === "admin" ? a : safe], next: null, positions: POSITIONS, departments: DEPARTMENTS };
        }
        if (request.data?.scope === "office") {
          if (p.role !== "officer" || !p.officerAssignmentId) fail("permission-denied", "An active officer assignment is required.");
          const a = await access(request, p.officerAssignmentId);
          if (!active(a, clock())) fail("permission-denied", "The term has ended.");
          filter = { position: a.position, department: a.department };
        }
        const result = await page(assignments, request, filter);
        // Appointment authorization may contain private administrative references.
        if (p.role !== "admin") result.items = result.items.map(({ authorization, appointedBy, completionReason, completedBy, ...safe }) => safe);
        return { ...result, positions: POSITIONS, departments: DEPARTMENTS };
      },
      async officerTracklist(request) {
        await access(request, request.data?.assignmentId);
        const result = await page(records, request, { assignmentId: id(request.data.assignmentId) });
        return { ...result, items: result.items.map(({ snapshot, ...metadata }) => metadata) };
      },
      async officerRecord(request) {
        const ref = records.doc(id(request.data?.recordId)), snap = await ref.get();
        if (!snap.exists) fail("not-found", "Historical record not found.");
        await access(request, snap.data().assignmentId);
        return { id: snap.id, ...snap.data() };
      },
      async officerReportSubmit(request) {
        await requireActiveRole(request, ["officer"]);
        const d = request.data || {};
        const title = text(d.title, "report title", 160), content = text(d.content, "report text", 20000);
        const operationId = id(d.operationId), ref = db.doc(`officer_report_receipts/${request.auth.uid}_${operationId}`);
        let recordId;
        await db.runTransaction(async tx => {
          const a = await context(tx, request, "reports.generate");
          if (!a || a.position !== "Treasurer") fail("permission-denied", "Financial report submission requires an active Treasurer assignment.");
          const previous = await tx.get(ref);
          if (previous.exists) { recordId = previous.data().recordId; return; }
          recordId = append(tx, a, { module: "Financial Reports", action: "Financial report submitted", status: "submitted", recordId: operationId, snapshot: { title, content } });
          tx.create(ref, { recordId });
        });
        return { id: recordId };
      }
    }
  };
}
module.exports = { createOfficerHistory, POSITIONS, active, id, text };
