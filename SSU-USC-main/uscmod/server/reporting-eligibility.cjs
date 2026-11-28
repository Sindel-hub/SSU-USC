"use strict";
const { randomUUID } = require("node:crypto");
const { ServiceError } = require("./settings.cjs");
function captureNeeded(previous, payload) {
  return (
    !previous ||
    (Boolean(previous.eligibilitySnapshotId) &&
      ["targetParticipants", "academicYear", "semester", "eventDate"].some(
        (key) =>
          JSON.stringify(previous[key] || "") !==
          JSON.stringify(payload[key] || ""),
      ))
  );
}
function queueEligibility(tx, db, eventRef, payload, actor, clock = Date.now) {
  const snapshotId = randomUUID();
  tx.create(db.doc(`reporting_eligibility/${snapshotId}`), {
    source: eventRef.path.split("/")[0],
    eventId: eventRef.id,
    state: "pending",
    next: null,
    page: 0,
    count: 0,
    scanned: 0,
    startedAtMs: clock(),
    createdByUid: actor,
    targetParticipants: payload.targetParticipants || {},
    academicYear: payload.academicYear || "",
    semester: payload.semester || "",
    eventDate: payload.eventDate || "",
  });
  return {
    eligibilitySnapshotId: snapshotId,
    eligibilitySnapshotState: "pending",
    eligibilityPolicyVersion: 1,
  };
}
function createEligibilityHandlers({
  db,
  requireOfficerPermission,
  history,
  clock = Date.now,
}) {
  return {
    async reportingCaptureEligibility(request) {
      const { source, eventId, after = null } = request.data || {};
      if (
        !["events", "programs"].includes(source) ||
        typeof eventId !== "string" ||
        !/^[\w-]{1,128}$/.test(eventId) ||
        (after !== null &&
          (typeof after !== "string" || !/^[\w-]{1,128}$/.test(after)))
      )
        throw new ServiceError(
          "invalid-argument",
          "Invalid eligibility capture request.",
        );
      await requireOfficerPermission(
        request,
        source === "events" ? "events.manage" : "programs.manage",
      );
      const eventRef = db.doc(`${source}/${eventId}`);
      let result;
      await db.runTransaction(async (tx) => {
        await history.context(
          tx,
          request,
          source === "events" ? "events.manage" : "programs.manage",
          { includeLegacy: true },
        );
        const event = (await tx.get(eventRef)).data();
        if (!event) throw new ServiceError("not-found", "Event not found.");
        if (!event.eligibilitySnapshotId) {
          if (
            event.eligibilityPolicyVersion !== 1 ||
            !Number.isSafeInteger(event.publishedAtMs)
          )
            throw new ServiceError(
              "failed-precondition",
              "Historical eligibility is unavailable for this legacy event.",
            );
          const queued = queueEligibility(
            tx,
            db,
            eventRef,
            event,
            request.auth.uid,
            clock,
          );
          tx.update(eventRef, queued);
          result = { state: "pending", next: null, count: 0 };
          return;
        }
        const ref = db.doc(
            `reporting_eligibility/${event.eligibilitySnapshotId}`,
          ),
          job = (await tx.get(ref)).data();
        if (!job || job.eventId !== eventId || job.source !== source)
          throw new ServiceError(
            "failed-precondition",
            "Eligibility capture metadata is invalid.",
          );
        const changed = [
          "targetParticipants",
          "academicYear",
          "semester",
          "eventDate",
        ].some(
          (key) =>
            JSON.stringify(job[key] || "") !== JSON.stringify(event[key] || ""),
        );
        if (changed) {
          if (event.participationStarted)
            throw new ServiceError(
              "failed-precondition",
              "Registered event classifications are locked. Restore the original event settings.",
            );
          const queued = queueEligibility(
            tx,
            db,
            eventRef,
            event,
            request.auth.uid,
            clock,
          );
          tx.update(eventRef, queued);
          result = { state: "pending", next: null, count: 0 };
          return;
        }
        if (job.state === "ready" || job.next !== after) {
          result = { state: job.state, next: job.next, count: job.count };
          return;
        }
        let query = db
          .collection("users")
          .where("role", "==", "student")
          .orderBy("__name__")
          .select(
            "role",
            "schoolProvisioned",
            "accountStatus",
            "isActive",
            "accountRemoved",
            "accountRemovalPending",
            "studentStanding",
            "studentId",
            "fullName",
            "college",
            "department",
            "program",
            "yearLevel",
            "section",
          );
        if (job.next) query = query.startAfter(job.next);
        const page = await tx.get(query.limit(101)),
          docs = page.docs.slice(0, 100),
          { eligibleForEvent, academicSnapshot } =
            await import("../shared/event-participation-model.mjs");
        const rows = docs
          .filter((doc) => {
            const p = doc.data();
            return (
              p.schoolProvisioned === true &&
              p.accountStatus === "approved" &&
              p.isActive !== false &&
              !p.accountRemoved &&
              !p.accountRemovalPending &&
              (!p.studentStanding || p.studentStanding === "active") &&
              eligibleForEvent(job, p)
            );
          })
          .map((doc) => ({ uid: doc.id, ...academicSnapshot(doc.data()) }));
        const finished = page.docs.length <= 100;
        for (let part = 0; part < rows.length; part += 50) {
          const chunk = rows.slice(part, part + 50);
          tx.create(
            ref
              .collection("chunks")
              .doc(String(job.page * 2 + part / 50).padStart(8, "0")),
            { uids: chunk.map((row) => row.uid), rows: chunk },
          );
        }
        const patch = {
          state: finished ? "ready" : "building",
          next: finished ? null : docs.at(-1).id,
          page: job.page + 1,
          count: job.count + rows.length,
          scanned: job.scanned + docs.length,
          ...(finished ? { completedAtMs: clock() } : {}),
        };
        tx.update(ref, patch);
        if (finished)
          tx.update(eventRef, { eligibilitySnapshotState: "ready" });
        result = { state: patch.state, next: patch.next, count: patch.count };
      });
      return result;
    },
  };
}
module.exports = { captureNeeded, queueEligibility, createEligibilityHandlers };
