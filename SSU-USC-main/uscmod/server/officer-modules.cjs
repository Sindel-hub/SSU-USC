"use strict";
const { ServiceError } = require("./settings.cjs");
const {captureNeeded,queueEligibility}=require("./reporting-eligibility.cjs");
const { id, text, actorAttribution } = require("./officer-history.cjs");
const fail = message => { throw new ServiceError("invalid-argument", message); };
function createOfficerModuleHandlers({ db, history, requireActiveRole, Timestamp, clock = Date.now }) {
  const permissions = { announcements: "bulletin.manage", events: "events.manage", programs: "programs.manage", complaints: "complaints.review" };
  async function validate(module, input, previous = null) {
    const title = text(input.title, "title", 160);
    const out = { title };
    const fields = { academicYear:80,semester:80,venue: 240, category: 80, description: 20000, audience: 120, participationNotes: 2000, hostOrganization: 240, imageUrl: 2000, imagePath: 500, externalRegistrationUrl: 2000 };
    for (const [key, max] of Object.entries(fields)) out[key] = text(input[key], key, max, !["description", "venue"].includes(key));
    for (const key of ["imageUrl", "externalRegistrationUrl"]) if (out[key]) {
      if (key === "imageUrl" && /^firestore-media:\/\/[a-zA-Z0-9_-]+$/.test(out[key])) continue;
      let url; try { url = new URL(out[key]); } catch { fail("Invalid media or registration URL."); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail("Invalid media or registration URL.");
    }
    out.eventDate = text(input.eventDate, "event date", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.eventDate) || new Date(out.eventDate + "T00:00:00Z").toJSON()?.slice(0, 10) !== out.eventDate) fail("Invalid event date.");
    for (const key of ["startTime", "endTime"]) {
      out[key] = text(input[key], key, 5, true);
      if (out[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out[key])) fail("Invalid event time.");
    }
    if (out.startTime && out.endTime && out.endTime <= out.startTime) fail("End time must follow start time.");
    out.registrationMode = input.registrationMode;
    if (!["internal", "external", "none"].includes(out.registrationMode)) fail("Invalid registration mode.");
    if ((!previous || previous.participationVersion === 1) && input.participationVersion !== 1) {
      fail("Configure internal registration and attendance schedules before publishing.");
    }
    const deadline = input.participationVersion === 1 ? input.registrationClosesAtMs : input.registrationDeadlineMs;
    // Existing closed registration deadlines may be preserved during unrelated edits; never accept a newly entered past deadline.
    const previousDeadline = previous?.registrationDeadline?.toMillis?.() ?? previous?.registrationDeadline;
    const unchangedDeadline = previous?.registrationMode === out.registrationMode && deadline === previousDeadline;
    if (out.registrationMode !== "none" && (!Number.isSafeInteger(deadline) || (deadline <= clock() && !unchangedDeadline) || deadline > Date.parse(out.eventDate + "T23:59:59+08:00"))) fail("Choose a future registration deadline no later than the event date.");
    if (out.registrationMode === "external" && !out.externalRegistrationUrl) fail("External registration URL is required.");
    out.registrationDeadline = out.registrationMode === "none" ? null : Timestamp.fromMillis(deadline);
    out.reminderEnabled = input.reminderEnabled === true;
    if (module === "programs") { out.sourceType = "program"; out.externalProgram = true; }
    if (input.participationVersion === 1) {
      if (!out.startTime || !out.endTime) fail("Event start and end time are required.");
      const { validateParticipationSchedule } = await import("../shared/event-participation-model.mjs");
      let config;
      try { config = validateParticipationSchedule(input); } catch (error) { fail(error.message); }
      const scheduleChanged = previous?.participationStarted && (
        ["eventDate", "startTime", "endTime", "academicYear", "semester"].some(key => out[key] !== previous[key]) ||
        Object.entries(config).some(([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value))
      );
      if (scheduleChanged) fail("Registration has started. Participation schedules and target groups are locked to preserve attendance history.");
      Object.assign(out, config);
      out.registrationDeadline = Timestamp.fromMillis(config.registrationClosesAtMs);
    }
    return out;
  }
  return {
    async officerModuleAction(request) {
      await requireActiveRole(request, ["officer"], { useOfficerProfile: true });
      const { module, action, input = {}, recordId, operationId, sourceCollection } = request.data || {};
      if (module === "announcements" && action === "publish") throw new ServiceError("failed-precondition", "Save a draft and complete content review before publishing.");
      const permission = Object.hasOwn(permissions, module) && permissions[module];
      if (!permission) fail("Unsupported officer module.");

      const receipt = db.doc(`officer_operation_receipts/${request.auth.uid}_${id(operationId)}`);
      const operation = { module, action, sourceCollection: sourceCollection || null };
      const documentId = recordId ? id(recordId) : id(operationId);
      let result;
      await db.runTransaction(async tx => {
        const a = await history.context(tx, request, permission, { includeLegacy: true });
        if (!a) throw new ServiceError("failed-precondition", "An active officer account is required.");
        const prior = await tx.get(receipt);
        if (prior.exists) {
          const { operation: previous, result: saved } = prior.data();
          if (previous && (previous.module !== module || previous.action !== action || previous.sourceCollection !== operation.sourceCollection || previous.documentId !== documentId)) fail("This operation ID is already in use.");
          result = saved;
          return;
        }
        if (module === "complaints") {
          if (action !== "review") fail("This tracked workflow supports complaint review only.");
          const ref = db.doc(`complaints/${documentId}`), snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError("not-found", "Complaint not found.");
          const before = snap.data(), patch = {};
          const feedback = input.feedback || input.reply;
          if (feedback && before.thread !== undefined && !Array.isArray(before.thread)) fail("This case has an invalid feedback history.");
          const thread = Array.isArray(before.thread) ? before.thread : [];
          const previousClassification = before.classification || [...thread].reverse().find(entry => entry?.classification)?.classification;
          if (input.status && input.status !== before.status) {
            if (!a.permissions.includes("complaints.status")) throw new ServiceError("permission-denied", "Complaint status permission is required.");
            if (!["Submitted", "Under Review", "In Progress", "Resolved", "Closed"].includes(input.status)) fail("Invalid complaint status.");
            patch.status = input.status;
          }
          if (input.classification && input.classification !== previousClassification) {
            if (!a.permissions.includes("complaints.classify")) throw new ServiceError("permission-denied", "Complaint classification permission is required.");
            if (!["Student Level", "Administrative Level", "Crisis Level"].includes(input.classification)) fail("Invalid complaint classification.");
            patch.classification = input.classification;
          }
          const priorStatus = before.status || "Submitted";
          if (feedback && (patch.status || priorStatus) === "Submitted" && a.permissions.includes("complaints.status")) patch.status = "Under Review";
          const status = patch.status || priorStatus;
          if (["In Progress", "Resolved", "Closed"].includes(status) && !["Student Level", "Administrative Level", "Crisis Level"].includes(patch.classification || previousClassification)) fail("Classify the complaint before progressing its status.");
          if (feedback) {
            if (!a.permissions.includes("complaints.feedback")) throw new ServiceError("permission-denied", "Complaint feedback permission is required.");
            const message = text(feedback, "feedback", 4000);
            const classification = patch.classification || previousClassification;
            if (!["Student Level", "Administrative Level", "Crisis Level"].includes(classification)) fail("Classify the complaint before sending feedback.");
            if (thread.length >= 200) fail("This case has reached the feedback limit; contact the administrator.");
            patch.thread = [...thread, { by: "Officer", kind: "feedback", actorUid: a.officerUid, classification, message, at: Timestamp.fromMillis(clock()) }];
          }
          if (!Object.keys(patch).length) {
            result = { ok: true, unchanged: true, status, classification: previousClassification || "" };
            tx.create(receipt, { result, operation: { ...operation, documentId } });
            return;
          }
          if(patch.status){if(patch.status==='Resolved'){patch.resolvedAt=Timestamp.fromMillis(clock());patch.resolutionOutcome='resolved';}else if(patch.status!=='Closed'){patch.resolutionOutcome='pending';}}
          tx.update(ref, { ...patch, updatedAt: Timestamp.fromMillis(clock()) });
          // Deliberately no complaint text, student identity, classification or attachment snapshot.
          if (patch.status) history.append(tx, a, { module: "Complaints", action: patch.status === "Resolved" ? "Resolved" : "Status updated", status, recordId: documentId });
          if (patch.thread) history.append(tx, a, { module: "Complaints", action: "Responded", status, recordId: documentId });
          result = { ok: true, status, classification: patch.classification || previousClassification || "" };
        } else if (["events", "programs"].includes(module) && ["publish", "update"].includes(action)) {
          const ref = db.doc(`${module}/${documentId}`);
          const existing = await tx.get(ref);
          if (action === "publish" && existing.exists) throw new ServiceError("already-exists", "This record already exists.");
          if (action === "update" && (!existing.exists || existing.data().officerArchived)) throw new ServiceError("permission-denied", "Only live records can be updated.");
          const previousData = existing.data();
          const payload = await validate(module, input, action === "update" ? previousData : null);
          if (action === "update" && Object.entries(payload).every(([key, value]) => {
            const previous = previousData[key];
            return value?.isEqual ? Boolean(previous?.isEqual && value.isEqual(previous)) : value && typeof value === "object" ? JSON.stringify(value) === JSON.stringify(previous) : value === previous;
          })) {
            result = { id: documentId, unchanged: true };
            tx.create(receipt, { result, operation: { ...operation, documentId } });
            return;
          }
          if(captureNeeded(previousData,payload))Object.assign(payload,queueEligibility(tx,db,ref,payload,request.auth.uid,clock));
          const timestamp = Timestamp.fromMillis(clock());
          const attribution = actorAttribution(a, clock());
          if (action === "update") tx.update(ref, { ...payload, updatedAt: timestamp, activityAttribution: { ...previousData.activityAttribution, updated: attribution } });
          else tx.create(ref, { ...payload, ...(a.assignmentId ? { officerAssignmentId: a.assignmentId } : {}), activityAttribution: { created: attribution }, createdByUid: a.officerUid, createdByEmail: "", status: "Published", registeredParticipants: 0, confirmedAttendance: 0, publishedAt: timestamp, publishedAtMs: clock(), updatedAt: timestamp });
          history.append(tx, a, { module: module === "events" ? "Events" : "Programs", action: action === "update" ? "Updated" : "Published", status: "published", recordId: documentId, recordTitle: payload.title, snapshot: { ...payload, registrationDeadline: input.registrationClosesAtMs ?? input.registrationDeadlineMs ?? null } });
          result = { id: documentId };
        } else if (module === "announcements" && ["archive", "delete", "restore", "permanent-delete"].includes(action)) {
          if (!["announcements", "archived_announcements", "deleted_announcements"].includes(sourceCollection)) fail("Invalid bulletin collection.");
          const ref = db.doc(`${sourceCollection}/${documentId}`), snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError("not-found", "Announcement not found.");
          const data = snap.data(), post = sourceCollection === "announcements" ? data : data.post;
          if (!post) fail("No saved announcement was found.");
          let destination, payload;
          const timestamp = Timestamp.fromMillis(clock());
          if (action === "archive" && sourceCollection === "announcements") { destination = "archived_announcements"; payload = { post, archivedAt: timestamp }; }
          else if (action === "delete" && sourceCollection !== "deleted_announcements") { destination = "deleted_announcements"; payload = { post, sourceCollection, deletedAt: timestamp, expiresAt: Timestamp.fromMillis(clock() + 30 * 86400000) }; }
          else if (action === "restore" && sourceCollection !== "announcements") {
            if (sourceCollection === "deleted_announcements" && (data.expiresAt?.toMillis?.() ?? data.expiresAt) <= clock()) fail("The restoration period has ended.");
            destination = data.sourceCollection === "archived_announcements" ? "archived_announcements" : "announcements";
            payload = destination === "announcements" ? post : { post, archivedAt: timestamp };
          } else if (!(action === "permanent-delete" && sourceCollection === "deleted_announcements")) fail("This action is unavailable.");
          if (action === "permanent-delete" && (data.expiresAt?.toMillis?.() ?? data.expiresAt) <= clock()) fail("The deletion period has ended.");
          const target = destination && db.doc(`${destination}/${documentId}`);
          if (target && (await tx.get(target)).exists) fail("A saved copy already exists.");
          if (target) {
            const key = action === "restore" ? "restored" : "removed";
            const attributedPost = { ...post, activityAttribution: { ...post.activityAttribution, [key]: actorAttribution(a, clock()) } };
            tx.create(target, destination === "announcements" ? attributedPost : { ...payload, post: attributedPost });
          }
          tx.delete(ref);
          history.append(tx, a, { module: "Bulletin Board", action, status: "completed", recordId: documentId, recordTitle: post.title || null });
          result = { id: documentId };
        } else if (["events", "programs"].includes(module) && action === "delete") {
          const ref = db.doc(`${module}/${documentId}`), snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError("not-found", "Record not found.");
          // Keep registrations and the original event for history; remove from live lists using a tombstone.
          if (snap.data().officerArchived) throw new ServiceError("failed-precondition", "This record is already archived.");
          const { eventDate, ...preserved } = snap.data();
          // Existing live feeds order by eventDate. Move that date into the
          // tombstone so archives cannot consume their bounded live-feed slots.
          tx.set(ref, { ...preserved, archivedEventDate: eventDate, officerArchived: true, status: "Archived", updatedAt: Timestamp.fromMillis(clock()) });
          history.append(tx, a, { module: module === "events" ? "Events" : "Programs", action: "Archived from live view", status: "archived", recordId: documentId, recordTitle: preserved.title || null });
          result = { id: documentId };
        } else fail("Unsupported officer action.");
        tx.create(receipt, { result, operation: { ...operation, documentId } });
      });
      return result;
    }
  };
}
module.exports = { createOfficerModuleHandlers };
