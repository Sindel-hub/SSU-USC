"use strict";
const { randomBytes, createHash } = require("node:crypto");
const { ServiceError } = require("./settings.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => {
  throw new ServiceError(code, message);
};
const safeId = (value) => {
  if (typeof value !== "string" || !/^[\w-]{1,128}$/.test(value))
    fail("invalid-argument", "Invalid record identifier.");
  return value;
};
function createEventParticipationHandlers({
  db,
  requireActiveRole,
  requireOfficerPermission,
  history,
  clock = Date.now,
  randomToken = () => randomBytes(32).toString("base64url"),
}) {
  const model = () => import("../shared/event-participation-model.mjs");
  const refs = (request) => {
    const source = request.data?.source || "events";
    if (!["events", "programs"].includes(source))
      fail("invalid-argument", "Invalid event source.");
    const eventId = safeId(request.data?.eventId);
    return {
      source,
      eventId,
      event: db.doc(`${source}/${eventId}`),
      permission: source === "events" ? "events.manage" : "programs.manage",
    };
  };
  function activeStudent(profile) {
    if (
      !profile ||
      profile.schoolProvisioned !== true ||
      profile.role !== "student" ||
      profile.accountStatus !== "approved" ||
      profile.isActive === false ||
      profile.accountRemoved ||
      profile.accountRemovalPending ||
      (profile.studentStanding && profile.studentStanding !== "active")
    )
      fail(
        "permission-denied",
        "The student account is inactive, suspended or removed.",
      );
  }
  async function student(request) {
    if (!request.auth?.uid)
      fail("unauthenticated", "Sign in with your student account.");
    const profile = (await db.doc(`users/${request.auth.uid}`).get()).data();
    activeStudent(profile);
    if (request.auth.token?.role && request.auth.token.role !== "student")
      fail("permission-denied", "Student access is required.");
    return profile;
  }
  function published(event) {
    if (!event || event.status !== "Published" || event.officerArchived)
      fail("failed-precondition", "This event is not published.");
  }
  async function officer(request, r) {
    await requireOfficerPermission(request, r.permission);
  }
  async function scanContext(tx, request, r, uid, mode) {
    if (!["in", "out"].includes(mode))
      fail("invalid-argument", "Select Time-in or Time-out mode.");
    await history.context(tx, request, r.permission, { includeLegacy: true });
    const [eventSnap, studentSnap, registrationSnap] = await Promise.all([
      tx.get(r.event),
      tx.get(db.doc(`users/${uid}`)),
      tx.get(r.event.collection("registrations").doc(uid)),
    ]);
    const event = eventSnap.data(),
      student = studentSnap.data(),
      registration = registrationSnap.data();
    published(event);
    activeStudent(student);
    const m = await model();
    const now = clock();
    if (!m.eligibleForEvent(event, student))
      fail("permission-denied", "Student is not eligible for this event.");
    if (!registration || registration.studentUid !== uid) {
      const closed =
        now >=
        m.milliseconds(
          event.registrationClosesAtMs || event.registrationDeadline,
        );
      fail(
        "failed-precondition",
        "Sorry, you have not registered for this event yet. Please proceed to the Events and Programs module and click the Register button." +
          (closed ? " Registration is closed." : ""),
      );
    }
    const open = event[mode === "in" ? "timeInOpensAtMs" : "timeOutOpensAtMs"];
    const close =
      event[mode === "in" ? "timeInClosesAtMs" : "timeOutClosesAtMs"];
    if (!Number.isSafeInteger(open) || !Number.isSafeInteger(close))
      fail(
        "failed-precondition",
        "Configure this event’s attendance schedules first.",
      );
    if (now < open)
      fail(
        "failed-precondition",
        "Attendance monitoring is not yet open for this mode.",
      );
    if (now >= close)
      fail(
        "failed-precondition",
        "Attendance monitoring is already closed for this mode.",
      );
    if (mode === "in" && registration.timeInAtMs != null)
      fail("already-exists", "Student is already checked in.");
    if (mode === "out" && registration.timeOutAtMs != null)
      fail("already-exists", "Student is already checked out.");
    if (mode === "out" && registration.timeInAtMs == null)
      fail(
        "failed-precondition",
        "Student cannot check out without checking in.",
      );
    return { event, student, registration, nowMs: now };
  }
  return {
    async participationStudents(request) {
      await requireOfficerPermission(
        request,
        request.data?.source === "programs"
          ? "programs.manage"
          : "events.manage",
      );
      if (request.data?.view === "participation") {
        let query = db.collectionGroup("registrations").orderBy("__name__");
        if (request.data.after) {
          if (
            !/^(events|programs)\/[\w-]{1,128}\/registrations\/[\w-]{1,128}$/.test(
              request.data.after,
            )
          )
            fail("invalid-argument", "Invalid participation cursor.");
          query = query.startAfter(db.doc(request.data.after));
        }
        const page = await query.limit(51).get(),
          m = await model(),
          rows = [];
        for (const doc of page.docs.slice(0, 50)) {
          const [source, eventId, collection, uid, ...extra] =
            doc.ref.path.split("/");
          if (
            source !== (request.data.source || "events") ||
            collection !== "registrations" ||
            extra.length
          )
            continue;
          const record = doc.data();
          if (record.studentUid !== uid) continue;
          const event = (await db.doc(`${source}/${eventId}`).get()).data() || {
            timeOutClosesAtMs: record.attendanceClosesAtMs,
          };
          rows.push({
            uid,
            eventId,
            ...(record.academicSnapshot || m.academicSnapshot(record)),
            eventSnapshot: record.eventSnapshot || {
              title: event.title,
              eventDate: event.eventDate,
            },
            registeredAtMs:
              record.registeredAtMs || m.milliseconds(record.registeredAt),
            timeInAtMs: record.timeInAtMs ?? null,
            timeOutAtMs: record.timeOutAtMs ?? null,
            durationMs: m.attendanceDuration(record),
            status: m.participationStatus(record, event, clock()),
          });
        }
        return {
          rows,
          next: page.docs.length > 50 ? page.docs[49].ref.path : null,
        };
      }
      let query = db
        .collection("users")
        .where("role", "==", "student")
        .orderBy("__name__");
      if (request.data?.after)
        query = query.startAfter(safeId(request.data.after));
      const page = await query.limit(51).get();
      const m = await model();
      return {
        rows: page.docs.slice(0, 50).map((doc) => ({
          uid: doc.id,
          ...m.academicSnapshot(doc.data()),
          active: doc.data().isActive,
          removed: doc.data().accountRemoved === true,
        })),
        next: page.docs.length > 50 ? page.docs[49].id : null,
      };
    },
    async participationEligible(request) {
      if (!request.auth?.uid) fail("unauthenticated", "Sign in first.");
      const uid = request.data?.studentUid || request.auth.uid;
      safeId(uid);
      const source = request.data?.source || "events";
      if (!["events", "programs"].includes(source))
        fail("invalid-argument", "Invalid event source.");
      if (uid === request.auth.uid) await student(request);
      else
        await requireOfficerPermission(
          request,
          source === "programs" ? "programs.manage" : "events.manage",
        );
      const profile = (await db.doc(`users/${uid}`).get()).data();
      const m = await model();
      let query = db
        .collection(source)
        .where("status", "==", "Published")
        .orderBy("__name__");
      if (request.data?.after)
        query = query.startAfter(safeId(request.data.after));
      const page = await query.limit(51).get();
      const rows = [];
      for (const doc of page.docs.slice(0, 50)) {
        const event = doc.data();
        if (event.officerArchived || !m.eligibleForEvent(event, profile))
          continue;
        const registration = (
          await doc.ref.collection("registrations").doc(uid).get()
        ).data();
        if (!registration)
          rows.push({
            id: `${source}_${doc.id}`,
            eventId: doc.id,
            source,
            studentUid: uid,
            ...m.academicSnapshot(profile),
            academicSnapshot: m.academicSnapshot(profile),
            eventSnapshot: {
              title: event.title,
              eventDate: event.eventDate,
              venue: event.venue,
            },
            status: "Not Registered",
            eligible: true,
          });
      }
      return { rows, next: page.docs.length > 50 ? page.docs[49].id : null };
    },
    async participationAcademicGroups(request) {
      await requireOfficerPermission(
        request,
        request.data?.source === "programs"
          ? "programs.manage"
          : "events.manage",
      );
      let query = db
        .collection("users")
        .where("role", "==", "student")
        .orderBy("__name__");
      if (request.data?.after)
        query = query.startAfter(safeId(request.data.after));
      const page = await query
        .select("college", "program", "yearLevel", "section")
        .limit(101)
        .get();
      const rows = page.docs.slice(0, 100).map((doc) => doc.data());
      return { rows, next: page.docs.length > 100 ? page.docs[99].id : null };
    },
    async participationQR(request) {
      await student(request);
      const uid = request.auth.uid,
        ref = db.doc(`student_qr/${uid}`);
      const token = randomToken();
      let saved;
      await db.runTransaction(async (tx) => {
        const [profile, snapshot] = await Promise.all([
          tx.get(db.doc(`users/${uid}`)),
          tx.get(ref),
        ]);
        activeStudent(profile.data());
        saved = snapshot.data();
        if (!saved) {
          const index = db.doc(`student_qr_tokens/${hash(token)}`);
          if ((await tx.get(index)).exists)
            fail("aborted", "QR assignment conflict. Retry.");
          saved = { uid, token, createdAtMs: clock() };
          tx.create(ref, saved);
          tx.create(index, { uid });
        }
      });
      const profile = (await db.doc(`users/${uid}`).get()).data();
      return {
        payload: `ssu-qr:${saved.token}`,
        student: (await model()).academicSnapshot(profile),
      };
    },
    async participationRegister(request) {
      await student(request);
      const r = refs(request),
        uid = request.auth.uid;
      const registrationRef = r.event.collection("registrations").doc(uid);
      let result;
      await db.runTransaction(async (tx) => {
        const [p, e, s] = await Promise.all([
          tx.get(db.doc(`users/${uid}`)),
          tx.get(r.event),
          tx.get(registrationRef),
        ]);
        const profile = p.data(),
          event = e.data();
        activeStudent(profile);
        published(event);
        const m = await model();
        if (!m.eligibleForEvent(event, profile))
          fail(
            "permission-denied",
            "Not eligible for this event’s target participants.",
          );
        if (s.exists) {
          result = {
            ...s.data(),
            status: m.participationStatus(s.data(), event, clock()),
            alreadyRegistered: true,
          };
          return;
        }
        if (event.registrationMode !== "internal")
          fail(
            "failed-precondition",
            "This event must be configured for internal registration.",
          );
        const now = clock();
        const state = m.registrationState(event, profile, null, now);
        if (state !== "Register") fail("failed-precondition", state);
        result = {
          eventId: r.eventId,
          source: r.source,
          studentUid: uid,
          ...m.academicSnapshot(profile),
          status: "Registered",
          registeredAt: new Date(now),
          registeredAtMs: now,
          academicSnapshot: m.academicSnapshot(profile),
          eventSnapshot: {
            title: event.title,
            eventDate: event.eventDate,
            venue: event.venue,
          },
          schemaVersion: 1,
          attendanceClosesAtMs: event.timeOutClosesAtMs || 0,
        };
        tx.create(registrationRef, result);
        tx.update(r.event, { participationStarted: true });
      });
      return result;
    },
    async participationLookup(request) {
      const r = refs(request);
      await officer(request, r);
      const payload = request.data?.qr;
      if (
        typeof payload !== "string" ||
        !/^ssu-qr:[A-Za-z0-9_-]{43}$/.test(payload)
      )
        fail("invalid-argument", "Invalid or unrecognized QR code.");
      const tokenHash = hash(payload.slice(7)),
        tokenRef = db.doc(`student_qr_tokens/${tokenHash}`);
      let result;
      const confirmation = randomToken();
      await db.runTransaction(async (tx) => {
        const token = await tx.get(tokenRef);
        const uid = token.data()?.uid;
        if (!uid) fail("not-found", "Invalid or unrecognized QR code.");
        const c = await scanContext(tx, request, r, uid, request.data.mode);
        const qr = await tx.get(db.doc(`student_qr/${uid}`));
        if (hash(qr.data()?.token || "") !== tokenHash)
          fail("not-found", "Invalid or unrecognized QR code.");
        const m = await model();
        result = {
          student: {
            uid,
            ...m.academicSnapshot(c.student),
            photoURL:
              c.student.profilePhoto ||
              c.student.profilePhotoUrl ||
              c.student.photoURL ||
              "",
          },
          registrationStatus: "Registered",
          attendanceStatus: m.participationStatus(
            c.registration,
            c.event,
            clock(),
          ),
          confirmation,
        };
        tx.create(db.doc(`attendance_confirmations/${hash(confirmation)}`), {
          uid,
          officerUid: request.auth.uid,
          eventId: r.eventId,
          source: r.source,
          mode: request.data.mode,
          expiresAtMs: clock() + 120000,
          used: false,
        });
      });
      return result;
    },
    async participationConfirm(request) {
      const r = refs(request);
      await officer(request, r);
      const confirmation = request.data?.confirmation;
      if (
        typeof confirmation !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(confirmation) ||
        request.data?.identityConfirmed !== true
      )
        fail(
          "invalid-argument",
          "Confirm the student’s physical school ID first.",
        );
      let result;
      await db.runTransaction(async (tx) => {
        const ticketRef = db.doc(
            `attendance_confirmations/${hash(confirmation)}`,
          ),
          ticket = (await tx.get(ticketRef)).data();
        if (
          !ticket ||
          ticket.officerUid !== request.auth.uid ||
          ticket.eventId !== r.eventId ||
          ticket.source !== r.source
        )
          fail(
            "permission-denied",
            "The confirmation belongs to another officer or event. Scan again.",
          );
        if (ticket.used) {
          result = ticket.result;
          return;
        }
        if (ticket.expiresAtMs <= clock())
          fail(
            "failed-precondition",
            "Identity confirmation expired. Scan again.",
          );
        const c = await scanContext(tx, request, r, ticket.uid, ticket.mode),
          now = c.nowMs;
        if (ticket.expiresAtMs <= now)
          fail(
            "failed-precondition",
            "Identity confirmation expired. Scan again.",
          );
        if (ticket.mode === "out" && now < c.registration.timeInAtMs)
          fail("failed-precondition", "Time-out cannot precede time-in.");
        const patch =
          ticket.mode === "in"
            ? {
                timeInAtMs: now,
                timeInOfficerUid: request.auth.uid,
                status: "Checked In",
              }
            : {
                timeOutAtMs: now,
                timeOutOfficerUid: request.auth.uid,
                durationMs: now - c.registration.timeInAtMs,
                status: "Completed",
              };
        // Existing registrations enter monitored attendance only after a verified scan.
        // Old registrations must not become retrospective absences when schedules are added.
        patch.schemaVersion = 1;
        patch.attendanceClosesAtMs = c.event.timeOutClosesAtMs;
        result = { ...c.registration, ...patch };
        tx.update(r.event.collection("registrations").doc(ticket.uid), patch);
        tx.update(ticketRef, { used: true, result });
        if (!c.event.participationStarted)
          tx.update(r.event, { participationStarted: true });
        const audit = {
          studentUid: ticket.uid,
          studentName: c.student.fullName || "",
          studentId: c.student.studentId || "",
          officerUid: request.auth.uid,
          eventId: r.eventId,
          source: r.source,
          mode: ticket.mode,
          recordedAtMs: now,
        };
        tx.create(r.event.collection("attendance_audit").doc(), audit);
      });
      return result;
    },
    async participationRoster(request) {
      const r = refs(request);
      await officer(request, r);
      const event = (await r.event.get()).data();
      if (!event) fail("not-found", "Event not found.");
      const m = await model();
      const unregistered = request.data?.unregistered === true;
      let query = unregistered
        ? db.collection("users").where("role", "==", "student")
        : r.event.collection("registrations");
      query = query.orderBy("__name__");
      if (request.data?.after)
        query = query.startAfter(safeId(request.data.after));
      const page = await query.limit(51).get();
      const docs = page.docs.slice(0, 50);
      const rows = [];
      for (const doc of docs) {
        const item = doc.data();
        let record = item;
        if (unregistered) {
          try {
            activeStudent(item);
          } catch {
            continue;
          }
          if (!m.eligibleForEvent(event, item)) continue;
          record = (
            await r.event.collection("registrations").doc(doc.id).get()
          ).data();
          if (record) continue;
        }
        const academic = unregistered
          ? m.academicSnapshot(item)
          : item.academicSnapshot || m.academicSnapshot(item);
        rows.push({
          uid: unregistered ? doc.id : item.studentUid,
          ...academic,
          registeredAtMs:
            record?.registeredAtMs || m.milliseconds(record?.registeredAt),
          timeInAtMs: record?.timeInAtMs ?? null,
          timeOutAtMs: record?.timeOutAtMs ?? null,
          durationMs: m.attendanceDuration(record),
          status: m.participationStatus(record, event, clock()),
        });
      }
      const regs = r.event.collection("registrations");
      const [total, checked, completed, monitored] = await Promise.all([
        regs.count().get(),
        regs.where("timeInAtMs", ">=", 0).count().get(),
        regs.where("timeOutAtMs", ">=", 0).count().get(),
        regs.where("schemaVersion", "==", 1).count().get(),
      ]);
      const registered = total.data().count,
        everChecked = checked.data().count,
        finished = completed.data().count;
      const closed =
        Boolean(event.timeOutClosesAtMs) && clock() >= event.timeOutClosesAtMs;
      const recent = (
        await r.event
          .collection("attendance_audit")
          .orderBy("recordedAtMs", "desc")
          .limit(10)
          .get()
      ).docs.map((doc) => doc.data());
      return {
        event,
        rows,
        recent,
        next: page.docs.length > 50 ? docs.at(-1).id : null,
        totals: {
          registered,
          checkedIn: closed ? 0 : everChecked - finished,
          checkedOut: finished,
          completed: finished,
          incomplete: closed ? everChecked - finished : 0,
          absent: closed
            ? Math.max(0, monitored.data().count - everChecked)
            : 0,
        },
        nowMs: clock(),
      };
    },
    async participationHistory(request) {
      if (!request.auth?.uid) fail("unauthenticated", "Sign in first.");
      const uid = request.data?.studentUid || request.auth.uid;
      if (uid === request.auth.uid) await student(request);
      else
        await requireOfficerPermission(
          request,
          request.data?.source === "programs"
            ? "programs.manage"
            : "events.manage",
        );
      safeId(uid);
      let query = db
        .collectionGroup("registrations")
        .where("studentUid", "==", uid)
        .orderBy("__name__");
      if (request.data?.after) {
        if (
          !/^(events|programs)\/[\w-]{1,128}\/registrations\/[\w-]{1,128}$/.test(
            request.data.after,
          )
        )
          fail("invalid-argument", "Invalid history cursor.");
        query = query.startAfter(db.doc(request.data.after));
      }
      const page = await query.limit(51).get();
      const m = await model();
      const rows = [];
      for (const doc of page.docs.slice(0, 50)) {
        const item = doc.data();
        const parts = doc.ref.path.split("/");
        item.source = parts[0];
        item.eventId = parts[1];
        if (!["events", "programs"].includes(item.source)) continue;
        if (
          uid !== request.auth.uid &&
          item.source !== (request.data?.source || "events")
        )
          continue;
        const event = (
          await db.doc(`${item.source}/${item.eventId}`).get()
        ).data() || {
          ...item.eventSnapshot,
          timeOutClosesAtMs: item.attendanceClosesAtMs,
        };
        rows.push({
          ...item,
          id: doc.ref.path.replaceAll("/", "_"),
          academicSnapshot: item.academicSnapshot || m.academicSnapshot(item),
          eventSnapshot: item.eventSnapshot || {
            title: event.title,
            eventDate: event.eventDate,
            venue: event.venue,
          },
          status: m.participationStatus(item, event, clock()),
          durationMs: m.attendanceDuration(item),
        });
      }
      const p = (await db.doc(`users/${uid}`).get()).data();
      return {
        student: m.academicSnapshot(p),
        rows,
        next: page.docs.length > 50 ? page.docs[49].ref.path : null,
      };
    },
  };
}
module.exports = { createEventParticipationHandlers };
