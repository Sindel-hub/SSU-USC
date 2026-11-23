"use strict";
const { ServiceError } = require("./settings.cjs");
const { id, text } = require("./officer-history.cjs");
const fail = message => { throw new ServiceError("invalid-argument", message); };
function createOfficerModuleHandlers({ db, history, requireActiveRole, requireOfficerPermission, Timestamp, clock = Date.now }) {
  const permissions = { announcements: "bulletin.manage", events: "events.manage", programs: "programs.manage", complaints: "complaints.review" };
  function validate(module, input) {
    const title = text(input.title, "title", 160);
    const out = { title };
    const fields = module === "announcements" ? { category: 80, audience: 120, content: 20000, imageUrl: 2000, imagePath: 500 } : { venue: 240, category: 80, description: 20000, audience: 120, participationNotes: 2000, hostOrganization: 240, imageUrl: 2000, imagePath: 500, externalRegistrationUrl: 2000 };
    for (const [key, max] of Object.entries(fields)) out[key] = text(input[key], key, max, !["content", "description", "venue"].includes(key));
    // Preserve existing announcement paragraphs and whitespace after validation.
    if (module === "announcements") out.content = input.content;
    for (const key of ["imageUrl", "externalRegistrationUrl"]) if (out[key]) {
      let url; try { url = new URL(out[key]); } catch { fail("Invalid media or registration URL."); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) fail("Invalid media or registration URL.");
    }
    if (module === "announcements") {
      out.surveyId = input.surveyId ? id(input.surveyId) : "";
      out.facebookRequested = input.facebookRequested === true;
    } else {
      out.eventDate = text(input.eventDate, "event date", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(out.eventDate) || new Date(out.eventDate + "T00:00:00Z").toJSON()?.slice(0, 10) !== out.eventDate) fail("Invalid event date.");
      for (const key of ["startTime", "endTime"]) {
        out[key] = text(input[key], key, 5, true);
        if (out[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out[key])) fail("Invalid event time.");
      }
      if (out.startTime && out.endTime && out.endTime <= out.startTime) fail("End time must follow start time.");
      out.registrationMode = input.registrationMode;
      if (!["internal", "external", "none"].includes(out.registrationMode)) fail("Invalid registration mode.");
      const deadline = input.registrationDeadlineMs;
      if (out.registrationMode !== "none" && (!Number.isSafeInteger(deadline) || deadline <= clock() || deadline > Date.parse(out.eventDate + "T23:59:59+08:00"))) fail("Choose a future registration deadline no later than the event date.");
      if (out.registrationMode === "external" && !out.externalRegistrationUrl) fail("External registration URL is required.");
      out.registrationDeadline = out.registrationMode === "none" ? null : Timestamp.fromMillis(deadline);
      out.reminderEnabled = input.reminderEnabled === true;
      if (module === "programs") { out.sourceType = "program"; out.externalProgram = true; }
    }
    return out;
  }
  return {
    async officerModuleAction(request) {
      await requireActiveRole(request, ["officer"]);
      const { module, action, input = {}, recordId, operationId, sourceCollection } = request.data || {};
      if (module === "announcements" && action === "publish") throw new ServiceError("failed-precondition", "Save a draft and complete content review before publishing.");
      const permission = permissions[module];
      if (!permission) fail("Unsupported officer module.");
      await requireOfficerPermission(request, permission);
      const receipt = db.doc(`officer_operation_receipts/${request.auth.uid}_${id(operationId)}`);
      const documentId = recordId ? id(recordId) : id(operationId);
      let result;
      await db.runTransaction(async tx => {
        const a = await history.context(tx, request, permission);
        if (!a) throw new ServiceError("failed-precondition", "The administrator must assign a position and term before using tracked operations.");
        const prior = await tx.get(receipt);
        if (prior.exists) { result = prior.data().result; return; }
        if (module === "complaints") {
          if (action !== "review") fail("This tracked workflow supports complaint review only.");
          const ref = db.doc(`complaints/${documentId}`), snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError("not-found", "Complaint not found.");
          const before = snap.data(), patch = {};
          if (input.status && input.status !== before.status) {
            if (!a.permissions.includes("complaints.status")) throw new ServiceError("permission-denied", "Complaint status permission is required.");
            if (!["Submitted", "Under Review", "In Progress", "Resolved", "Closed"].includes(input.status)) fail("Invalid complaint status.");
            patch.status = input.status;
          }
          if (input.classification && input.classification !== before.classification) {
            if (!a.permissions.includes("complaints.classify")) throw new ServiceError("permission-denied", "Complaint classification permission is required.");
            if (!["Student Level", "Administrative Level", "Crisis Level"].includes(input.classification)) fail("Invalid complaint classification.");
            patch.classification = input.classification;
          }
          const status = patch.status || before.status;
          if (["In Progress", "Resolved", "Closed"].includes(status) && !["Student Level", "Administrative Level", "Crisis Level"].includes(patch.classification || before.classification)) fail("Classify the complaint before progressing its status.");
          if (input.feedback) {
            if (!a.permissions.includes("complaints.feedback")) throw new ServiceError("permission-denied", "Complaint feedback permission is required.");
            const message = text(input.feedback, "feedback", 4000);
            const classification = patch.classification || before.classification;
            if (!["Student Level", "Administrative Level", "Crisis Level"].includes(classification)) fail("Classify the complaint before sending feedback.");
            const thread = Array.isArray(before.thread) ? before.thread : [];
            if (thread.length >= 100) fail("This case has reached the feedback limit; contact the administrator.");
            patch.thread = [...thread, { by: "Officer", kind: "feedback", actorUid: a.officerUid, classification, message, at: Timestamp.fromMillis(clock()) }];
          }
          if (!Object.keys(patch).length) { result = { ok: true, unchanged: true }; return; }
          tx.update(ref, { ...patch, updatedAt: Timestamp.fromMillis(clock()) });
          // Deliberately no complaint text, student identity, classification or attachment snapshot.
          history.append(tx, a, { module: "Complaints", action: "Complaint review updated", status: "completed", recordId: documentId });
          result = { ok: true, status, classification: patch.classification || before.classification || "" };
        } else if (action === "publish" || (["events", "programs"].includes(module) && action === "update")) {
          const payload = validate(module, input), ref = db.doc(`${module}/${documentId}`);
          const existing = await tx.get(ref);
          if (action === "publish" && existing.exists) throw new ServiceError("already-exists", "This record already exists.");
          if (action === "update" && (!existing.exists || existing.data().officerAssignmentId !== a.assignmentId || existing.data().officerArchived)) throw new ServiceError("permission-denied", "Only live records from your own current assignment can be updated.");
          if (payload.surveyId) {
            const survey = await tx.get(db.doc(`needs_assessment_surveys/${payload.surveyId}`));
            if (!survey.exists || survey.data().status !== "published") fail("Attach a published survey.");
          }
          const timestamp = Timestamp.fromMillis(clock());
          if (action === "update") tx.update(ref, { ...payload, updatedAt: timestamp });
          else tx.create(ref, { ...payload, officerAssignmentId: a.assignmentId, createdByUid: a.officerUid, createdByEmail: "", ...(module === "announcements" ? { createdAt: timestamp, createdAtMs: clock() } : { status: "Published", registeredParticipants: 0, confirmedAttendance: 0, publishedAt: timestamp, publishedAtMs: clock(), updatedAt: timestamp }) });
          history.append(tx, a, { module: module === "announcements" ? "Bulletin Board" : module === "events" ? "Events" : "Programs", action: action === "update" ? "Updated" : "Published", status: "published", recordId: documentId, snapshot: { ...payload, registrationDeadline: input.registrationDeadlineMs ?? null } });
          result = { id: documentId };
        } else if (module === "announcements" && ["archive", "delete", "restore", "permanent-delete"].includes(action)) {
          if (!["announcements", "archived_announcements", "deleted_announcements"].includes(sourceCollection)) fail("Invalid bulletin collection.");
          const ref = db.doc(`${sourceCollection}/${documentId}`), snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError("not-found", "Announcement not found.");
          const data = snap.data(), post = sourceCollection === "announcements" ? data : data.post;
          if (post?.officerAssignmentId !== a.assignmentId) throw new ServiceError("permission-denied", "Previous officers' announcements are read-only. Publish a new record under your own assignment.");
          let destination, payload;
          const timestamp = Timestamp.fromMillis(clock());
          if (action === "archive" && sourceCollection === "announcements") { destination = "archived_announcements"; payload = { post, archivedAt: timestamp }; }
          else if (action === "delete" && sourceCollection !== "deleted_announcements") { destination = "deleted_announcements"; payload = { post, sourceCollection, deletedAt: timestamp, expiresAt: Timestamp.fromMillis(clock() + 30 * 86400000) }; }
          else if (action === "restore" && sourceCollection !== "announcements") {
            if (sourceCollection === "deleted_announcements" && (data.expiresAt?.toMillis?.() ?? data.expiresAt) <= clock()) fail("The restoration period has ended.");
            destination = data.sourceCollection === "archived_announcements" ? "archived_announcements" : "announcements";
            payload = destination === "announcements" ? post : { post, archivedAt: timestamp };
          } else if (!(action === "permanent-delete" && sourceCollection === "deleted_announcements")) fail("This action is unavailable.");
          const target = destination && db.doc(`${destination}/${documentId}`);
          if (target && (await tx.get(target)).exists) fail("A saved copy already exists.");
          if (target) tx.create(target, payload);
          tx.delete(ref);
          history.append(tx, a, { module: "Bulletin Board", action, status: "completed", recordId: documentId });
          result = { id: documentId };
        } else if (["events", "programs"].includes(module) && action === "delete") {
          const ref = db.doc(`${module}/${documentId}`), snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError("not-found", "Record not found.");
          if (snap.data().officerAssignmentId !== a.assignmentId) throw new ServiceError("permission-denied", "Previous officers' records are read-only.");
          // Keep registrations and the original event for history; remove from live lists using a tombstone.
          if (snap.data().officerArchived) throw new ServiceError("failed-precondition", "This record is already archived.");
          const { eventDate, ...preserved } = snap.data();
          // Existing live feeds order by eventDate. Move that date into the
          // tombstone so archives cannot consume their bounded live-feed slots.
          tx.set(ref, { ...preserved, archivedEventDate: eventDate, officerArchived: true, status: "Archived", updatedAt: Timestamp.fromMillis(clock()) });
          history.append(tx, a, { module: module === "events" ? "Events" : "Programs", action: "Archived from live view", status: "completed", recordId: documentId });
          result = { id: documentId };
        } else fail("Unsupported officer action.");
        tx.create(receipt, { result });
      });
      return result;
    }
  };
}
module.exports = { createOfficerModuleHandlers };
