"use strict";
const { createHash } = require("node:crypto");
const { ServiceError } = require("./settings.cjs");
const { id } = require("./officer-history.cjs");
const fail = (code, message) => {
  throw new ServiceError(code, message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const MODEL = () => import("../shared/reporting-model.mjs");
const MODULES = {
  Events: ["events.manage"],
  Programs: ["programs.manage"],
  Complaints: ["complaints.view", "complaints.review"],
  "Bulletin Board": [
    "bulletin.draft",
    "bulletin.review",
    "bulletin.publish",
    "bulletin.manage",
  ],
  "Needs Assessment": [
    "bulletin.manage",
    "bulletin.review",
    "bulletin.publish",
  ],
};
function filters(input = {}) {
  const keys = [
    "college",
    "program",
    "yearLevel",
    "section",
    "status",
    "search",
    "from",
    "until",
    "resolvedFrom",
    "resolvedUntil",
    "academicYear",
    "semester",
    "officer",
    "activityType",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    fail("invalid-argument", "Invalid report filters.");
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length > 160)
      fail("invalid-argument", "Invalid report filter value.");
    if (
      ["from", "until", "resolvedFrom", "resolvedUntil"].includes(key) &&
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        new Date(value + "T00:00:00Z").toJSON()?.slice(0, 10) !== value)
    )
      fail("invalid-argument", "Invalid report date.");
  }
  if (
    (input.from && input.until && input.from > input.until) ||
    (input.resolvedFrom &&
      input.resolvedUntil &&
      input.resolvedFrom > input.resolvedUntil)
  )
    fail("invalid-argument", "The date range is reversed.");
  return input;
}
function createReportingHandlers({
  db,
  requireOfficerPermission,
  history,
  clock = Date.now,
}) {
  async function rights(request) {
    const p = await requireOfficerPermission(request, "reports.generate");
    const { effectiveOfficerPermissions } =
      await import("../shared/officer-permissions.js");
    const ps = effectiveOfficerPermissions(p, { legacyFullAccess: false }),
      admin = p.role === "admin" && request.auth.token.role === "admin",
      has = (permission) => admin || ps.includes(permission);
    return {
      profile: p,
      has,
      admin,
      allOfficers:
        admin || (p.officePosition === "President" && has("dashboard.view")),
      events: true,
      complaints:
        has("complaints.view") ||
        has("complaints.review") ||
        has("complaints.report"),
      complaintDetails: has("complaints.review"),
      complaintExport: has("complaints.report"),
      details: {
        events: has("events.manage"),
        programs: has("programs.manage"),
      },
      modules: Object.keys(MODULES).filter(
        (key) => admin || MODULES[key].some(has),
      ),
    };
  }
  function eventRef(data) {
    if (!["events", "programs"].includes(data.source))
      fail("invalid-argument", "Invalid event source.");
    return db.doc(`${data.source}/${id(data.eventId)}`);
  }
  function incremental(query, data, field) {
    if (data.since != null) {
      if (
        !Number.isSafeInteger(data.since) ||
        data.since < 0 ||
        data.since > clock() + 60000
      )
        fail("invalid-argument", "Invalid update cursor.");
      query = query
        .where(field, ">=", data.since)
        .orderBy(field)
        .orderBy("__name__");
      if (data.after) {
        const c = data.after;
        if (!c || !Number.isSafeInteger(c.at) || typeof c.id !== "string")
          fail("invalid-argument", "Invalid update cursor.");
        query = query.startAfter(c.at, id(c.id));
      }
    } else {
      query = query.orderBy("__name__");
      if (data.after) query = query.startAfter(id(data.after));
    }
    return query;
  }
  const next = (page, data, field) =>
    page.docs.length > 200
      ? data.since != null
        ? { id: page.docs[199].id, at: page.docs[199].data()[field] }
        : page.docs[199].id
      : null;
  function redactAttendance(row, access, uid) {
    if (access) return row;
    const minimal = Object.fromEntries(
      ["college", "program", "yearLevel", "section"].map((k) => [
        k,
        row[k] || row.academicSnapshot?.[k] || "",
      ]),
    );
    const anon = hash(uid + ":" + (row.uid || row.studentUid || ""));
    return {
      ...minimal,
      uid: anon,
      studentUid: anon,
      academicSnapshot: minimal,
      registeredAtMs: row.registeredAtMs,
      timeInAtMs: row.timeInAtMs,
      timeOutAtMs: row.timeOutAtMs,
      attendanceClosesAtMs: row.attendanceClosesAtMs,
      schemaVersion: row.schemaVersion,
      reportUpdatedAtMs: row.reportUpdatedAtMs,
    };
  }
  return {
    async reportingCapabilities(request) {
      const r = await rights(request);
      return {
        nowMs: clock(),
        actor: { uid: request.auth.uid, name: r.profile.fullName || "" },
        complaints: r.complaints,
        complaintDetails: r.complaintDetails,
        complaintExport: r.complaintExport,
        attendanceDetails: r.details,
        allOfficers: r.allOfficers,
      };
    },
    async reportingPage(request) {
      const r = await rights(request),
        data = request.data || {},
        f = filters(data.filters || {}),
        m = await MODEL(),
        started = clock();
      let query;
      if (data.section === "catalog") {
        if (!["events", "programs"].includes(data.source))
          fail("invalid-argument", "Invalid event source.");
        query = db.collection(data.source).orderBy("__name__");
        if (data.after) query = query.startAfter(id(data.after));
        const page = await query.limit(201).get();
        const rows = page.docs
          .slice(0, 200)
          .map((doc) => ({ id: doc.id, source: data.source, ...doc.data() }))
          .filter(
            (event) =>
              m.eventMatches(event, f) &&
              ["Published", "Archived", "Completed", "Cancelled"].includes(
                event.status,
              ),
          )
          .map((event) =>
            Object.fromEntries(
              [
                "id",
                "source",
                "title",
                "eventDate",
                "archivedEventDate",
                "startTime",
                "endTime",
                "venue",
                "academicYear",
                "semester",
                "status",
                "eligibilitySnapshotId",
                "eligibilitySnapshotState",
                "eligibilityPolicyVersion",
                "timeInOpensAtMs",
                "timeOutClosesAtMs",
                "targetParticipants",
              ].map((key) => [key, event[key] ?? null]),
            ),
          );
        return {
          rows,
          next: page.docs.length > 200 ? page.docs[199].id : null,
          nowMs: started,
        };
      }
      if (data.section === "attendance") {
        const ref = eventRef(data),
          event = (await ref.get()).data();
        if (!event) fail("not-found", "Event not found.");
        const snapshot = event.eligibilitySnapshotId
          ? (
              await db
                .doc(`reporting_eligibility/${id(event.eligibilitySnapshotId)}`)
                .get()
            ).data()
          : null;
        if (
          event.eligibilitySnapshotId &&
          (!snapshot ||
            snapshot.source !== data.source ||
            snapshot.eventId !== ref.id)
        )
          fail(
            "failed-precondition",
            "The event eligibility snapshot is invalid.",
          );
        const complete = Boolean(
          snapshot &&
          snapshot.state === "ready" &&
          event.eligibilitySnapshotState === "ready",
        );
        const detailed = r.details[data.source];
        let rows = [],
          cursor = null;
        if (data.phase === "population") {
          if (complete) {
            query = db
              .doc(`reporting_eligibility/${event.eligibilitySnapshotId}`)
              .collection("chunks")
              .orderBy("__name__");
            if (data.after) query = query.startAfter(id(data.after));
            const page = await query.limit(11).get();
            rows = page.docs
              .slice(0, 10)
              .flatMap((doc) => doc.data().rows || [])
              .filter((row) => m.matchesScope(row, f));
            cursor = page.docs.length > 10 ? page.docs[9].id : null;
          }
        } else if (data.phase === "registrations") {
          query = incremental(
            ref.collection("registrations"),
            data,
            "reportUpdatedAtMs",
          );
          const page = await query.limit(201).get();
          rows = page.docs
            .slice(0, 200)
            .map((doc) => ({ uid: doc.id, ...doc.data() }))
            .filter((row) => m.matchesScope(row.academicSnapshot || row, f));
          cursor = next(page, data, "reportUpdatedAtMs");
        } else fail("invalid-argument", "Invalid attendance page.");
        return {
          rows: rows.map((row) =>
            redactAttendance(row, detailed, request.auth.uid),
          ),
          next: cursor,
          nowMs: started,
          complete,
          mayViewRecords: detailed,
          event: {
            ...Object.fromEntries(
              [
                "title",
                "eventDate",
                "archivedEventDate",
                "venue",
                "academicYear",
                "semester",
                "status",
                "startTime",
                "endTime",
                "timeInOpensAtMs",
                "timeInClosesAtMs",
                "timeOutOpensAtMs",
                "timeOutClosesAtMs",
                "eligibilitySnapshotId",
                "eligibilitySnapshotState",
                "eligibilityPolicyVersion",
              ].map((key) => [key, event[key] ?? null]),
            ),
            id: ref.id,
            source: data.source,
            eligibilityCapture: snapshot
              ? {
                  startedAtMs: snapshot.startedAtMs,
                  completedAtMs: snapshot.completedAtMs,
                  count: snapshot.count,
                }
              : null,
          },
        };
      }
      if (data.section === "complaints") {
        if (!r.complaints)
          fail(
            "permission-denied",
            "Complaint reporting is not assigned to your role.",
          );
        if (
          (f.search && !r.complaintDetails) ||
          (f.officer && !r.complaintDetails)
        )
          fail(
            "permission-denied",
            "Individual complaint filters are not authorized.",
          );
        query = db.collection("complaints");
        if (data.since != null) {
          if (
            !Number.isSafeInteger(data.since) ||
            data.since < 0 ||
            data.since > clock() + 60000
          )
            fail("invalid-argument", "Invalid update cursor.");
          query = query
            .where("updatedAt", ">=", new Date(data.since))
            .orderBy("updatedAt")
            .orderBy("__name__");
          if (data.after) {
            if (!Number.isSafeInteger(data.after.at))
              fail("invalid-argument", "Invalid update cursor.");
            query = query.startAfter(
              new Date(data.after.at),
              id(data.after.id),
            );
          }
        } else {
          query = query.orderBy("__name__");
          if (data.after) query = query.startAfter(id(data.after));
        }
        query = query.select(
          "status",
          "college",
          "department",
          "studentCollege",
          "studentDepartment",
          "complaintRef",
          "subject",
          "createdAt",
          "updatedAt",
          "resolvedAt",
          "resolutionOutcome",
          "assignedOfficerUid",
          "assignedTo",
          "category",
          "isAnonymous",
          "anonymous",
          "confidential",
          "academicYear",
          "semester",
        );
        const page = await query.limit(201).get();
        const rows = page.docs
          .slice(0, 200)
          .map((doc) => {
            const p = doc.data();
            return {
              id: r.complaintDetails
                ? doc.id
                : hash(request.auth.uid + ":" + doc.id),
              reference: r.complaintDetails
                ? String(p.complaintRef || doc.id).slice(0, 160)
                : "",
              subject: r.complaintDetails
                ? String(p.subject || "").slice(0, 200)
                : "",
              college: String(
                p.college ||
                  p.department ||
                  p.studentCollege ||
                  p.studentDepartment ||
                  "",
              ),
              status: p.status || "Submitted",
              createdAtMs: mTime(p.createdAt),
              updatedAtMs: mTime(p.updatedAt),
              resolvedAtMs: mTime(p.resolvedAt),
              resolutionOutcome: p.resolutionOutcome || "",
              assigned: Boolean(p.assignedOfficerUid || p.assignedTo),
              assignedOfficer: r.complaintDetails
                ? String(p.assignedOfficerUid || p.assignedTo || "")
                : "",
              category: String(p.category || "").slice(0, 240),
              academicYear: String(p.academicYear || ""),
              semester: String(p.semester || ""),
              anonymous:
                p.anonymous === true ||
                p.isAnonymous === true ||
                p.confidential === true,
            };
          })
          .filter(
            (row) =>
              m.complaintMatches(row, f) &&
              (!f.academicYear || row.academicYear === f.academicYear) &&
              (!f.semester || row.semester === f.semester),
          );
        return {
          rows,
          next:
            page.docs.length > 200
              ? data.since != null
                ? {
                    id: page.docs[199].id,
                    at: mTime(page.docs[199].data().updatedAt),
                  }
                : page.docs[199].id
              : null,
          nowMs: started,
          mayViewRecords: r.complaintDetails,
        };
      }
      if (data.section === "activities") {
        if (f.officer && f.officer !== request.auth.uid && !r.allOfficers)
          fail(
            "permission-denied",
            "This role can only report its own officer activity.",
          );
        const collection =
          data.phase === "officers"
            ? "officer_records"
            : data.phase === "attendance"
              ? "attendance_audit"
              : data.phase === "reports"
                ? "reporting_audit"
                : null;
        if (!collection) fail("invalid-argument", "Invalid activity source.");
        query =
          collection === "attendance_audit"
            ? db.collectionGroup(collection)
            : db.collection(collection);
        if (!r.allOfficers)
          query = query.where("officerUid", "==", request.auth.uid);
        const timeField =
          collection === "attendance_audit" ? "recordedAtMs" : "createdAtMs";
        if (data.since != null) {
          if (
            !Number.isSafeInteger(data.since) ||
            data.since < 0 ||
            data.since > clock() + 60000
          )
            fail("invalid-argument", "Invalid update cursor.");
          query = query.where(timeField, ">=", data.since).orderBy(timeField);
        }
        query = query.orderBy("__name__");
        if (data.after) {
          const after = data.since != null ? data.after.id : data.after;
          if (data.since != null && !Number.isSafeInteger(data.after.at))
            fail("invalid-argument", "Invalid update cursor.");
          const values = data.since != null ? [data.after.at] : [];
          if (collection === "attendance_audit") {
            if (
              typeof after !== "string" ||
              !/^(events|programs)\/[\w-]+\/attendance_audit\/[\w-]+$/.test(
                after,
              )
            )
              fail("invalid-argument", "Invalid activity cursor.");
            query = query.startAfter(...values, db.doc(after));
          } else query = query.startAfter(...values, id(after));
        }
        query = query.select(
          "module",
          "action",
          "status",
          "recordId",
          "recordTitle",
          "officerUid",
          "officerName",
          "position",
          "administration",
          "createdAtMs",
          "recordedAtMs",
          "eventId",
          "source",
          "mode",
          "type",
          "filters",
        );
        const page = await query.limit(201).get();
        const rows = page.docs
          .slice(0, 200)
          .map((doc) => {
            const p = doc.data();
            return {
              id: doc.ref.path.replaceAll("/", "_"),
              module:
                collection === "attendance_audit"
                  ? p.source === "programs"
                    ? "Programs"
                    : "Events"
                  : collection === "reporting_audit"
                    ? "Reporting"
                    : p.module,
              action:
                collection === "attendance_audit"
                  ? p.mode === "in"
                    ? "Time-in recorded"
                    : "Time-out recorded"
                  : collection === "reporting_audit"
                    ? "Report export authorized"
                    : p.action,
              status: p.status || "",
              officerUid: p.officerUid,
              officerName: p.officerName || "",
              createdAtMs: p.createdAtMs || p.recordedAtMs || 0,
              administration: p.administration || "",
              recordTitle:
                p.module === "Complaints"
                  ? ""
                  : String(p.recordTitle || "").slice(0, 160),
              recordId:
                p.module === "Complaints" && !r.complaintDetails
                  ? ""
                  : p.recordId || p.eventId || "",
            };
          })
          .filter(
            (row) =>
              (row.module !== "Bulletin Board" ||
                [
                  "Draft saved",
                  "Created",
                  "Updated",
                  "Published reviewed announcement",
                  "Published",
                  "archive",
                  "delete",
                  "permanent-delete",
                  "restore",
                ].includes(row.action)) &&
              (!r.allOfficers ||
                row.module === "Reporting" ||
                r.modules.includes(row.module)) &&
              (!f.officer || row.officerUid === f.officer) &&
              (!f.activityType || row.action === f.activityType) &&
              (!f.from || m.day(row.createdAtMs) >= f.from) &&
              (!f.until || m.day(row.createdAtMs) <= f.until) &&
              (!f.academicYear || row.administration === f.academicYear),
          );
        return {
          rows,
          next:
            page.docs.length > 200
              ? data.since != null
                ? {
                    id:
                      collection === "attendance_audit"
                        ? page.docs[199].ref.path
                        : page.docs[199].id,
                    at: page.docs[199].data()[timeField],
                  }
                : collection === "attendance_audit"
                  ? page.docs[199].ref.path
                  : page.docs[199].id
              : null,
          nowMs: started,
          allOfficers: r.allOfficers,
        };
      }
      fail("invalid-argument", "Invalid reporting section.");
    },
    async reportingExportAudit(request) {
      const r = await rights(request),
        data = request.data || {},
        f = filters(data.filters || {}),
        type = data.type;
      if (
        ![
          "attendance",
          "attendance-summary",
          "complaints",
          "complaints-summary",
          "activities",
        ].includes(type)
      )
        fail("invalid-argument", "Invalid report type.");
      if (
        type.startsWith("complaints") &&
        (!r.complaints ||
          !r.complaintExport ||
          (type === "complaints" && !r.complaintDetails))
      )
        fail(
          "permission-denied",
          "Complaint export is not assigned to your role.",
        );
      if (type.startsWith("attendance")) {
        const events = data.events;
        if (!Array.isArray(events) || !events.length || events.length > 20)
          fail(
            "invalid-argument",
            "Select between one and twenty events for export.",
          );
        for (const event of events) {
          eventRef(event);
          if (type === "attendance" && !r.details[event.source])
            fail(
              "permission-denied",
              "Detailed attendance export is not assigned to your role.",
            );
        }
      }
      if (
        type === "activities" &&
        f.officer &&
        f.officer !== request.auth.uid &&
        !r.allOfficers
      )
        fail(
          "permission-denied",
          "This role can only export its own activities.",
        );
      if (data.events !== undefined) {
        if (!Array.isArray(data.events) || data.events.length > 20)
          fail("invalid-argument", "Invalid report events.");
        for (const event of data.events) eventRef(event);
      }
      const requestHash = hash(
        JSON.stringify({ type, filters: f, events: data.events || [] }),
      );
      const operationId = id(data.operationId),
        ref = db.doc(`reporting_audit/${request.auth.uid}_${operationId}`);
      await db.runTransaction(async (tx) => {
        const fresh = await history.context(tx, request, "reports.generate", {
          includeLegacy: true,
        });
        if (fresh) {
          const has = (key) => fresh.permissions.includes(key);
          if (
            type.startsWith("complaints") &&
            (!has("complaints.report") ||
              (type === "complaints" && !has("complaints.review")))
          )
            fail("permission-denied", "Complaint export permission changed.");
          if (
            type === "attendance" &&
            data.events.some(
              (e) =>
                !has(
                  e.source === "events" ? "events.manage" : "programs.manage",
                ),
            )
          )
            fail("permission-denied", "Attendance export permission changed.");
        }
        const prior = await tx.get(ref);
        if (prior.exists && prior.data().requestHash !== requestHash)
          fail(
            "invalid-argument",
            "This export operation is already bound to another report.",
          );
        if (!prior.exists)
          tx.create(ref, {
            officerUid: request.auth.uid,
            officerName: r.profile.fullName || "",
            type,
            filters: f,
            events: data.events || [],
            requestHash,
            createdAtMs: clock(),
          });
      });
      return {
        authorized: true,
        generatedBy: r.profile.fullName || "",
        atMs: clock(),
      };
    },
  };
}
function mTime(value) {
  if (value == null) return null;
  return (
    value.toMillis?.() ??
    value.toDate?.()?.getTime() ??
    (typeof value === "number" ? value : new Date(value).getTime())
  );
}
module.exports = { createReportingHandlers, filters };
