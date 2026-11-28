import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  participationStatus,
  validateParticipationSchedule,
  eligibleForEvent,
  registrationState,
  academicSnapshot,
  attendanceDuration,
} from "../shared/event-participation-model.mjs";
const require = createRequire(import.meta.url),
  { participationFixture } = require("./helpers/participation-fixture.cjs");
test("existing students get one stable opaque QR and updated profile information", async () => {
  const f = participationFixture();
  const [one, two] = await Promise.all([
    f.h.participationQR(f.req("first")),
    f.h.participationQR(f.req("first")),
  ]);
  assert.equal(one.payload, two.payload);
  assert.match(one.payload, /^ssu-qr:[\w-]{43}$/);
  assert.equal(one.payload.includes("990001"), false);
  f.records.get("users/first").section = "4B";
  const third = await f.h.participationQR(f.req("first"));
  assert.equal(third.payload, one.payload);
  assert.equal(third.student.section, "4B");
});
test("concurrent registration is idempotent and never records attendance", async () => {
  const f = participationFixture();
  await Promise.all([f.register("first"), f.register("first")]);
  const record = f.records.get("events/assembly/registrations/first");
  assert.equal(record.studentUid, "first");
  assert.equal(record.timeInAtMs, undefined);
  assert.equal(record.status, "Registered");
  assert.equal(
    [...f.records.keys()].filter((path) =>
      path.startsWith("events/assembly/registrations"),
    ).length,
    1,
  );
});
for (const state of ["closed", "not open", "target", "inactive", "unpublished"])
  test("registration rejects " + state, async () => {
    const f = participationFixture(),
      event = f.records.get("events/assembly");
    if (state === "closed") event.registrationClosesAtMs = f.now;
    if (state === "not open") event.registrationOpensAtMs = f.now + 1;
    if (state === "target")
      event.targetParticipants.section = ["Other Section"];
    if (state === "inactive") f.records.get("users/first").isActive = false;
    if (state === "unpublished") event.status = "Draft";
    await assert.rejects(f.register("first"));
    assert.equal(f.records.has("events/assembly/registrations/first"), false);
  });
test("lookup only previews identity and confirmation records server time", async () => {
  const f = participationFixture();
  await f.register("first");
  const qr = await f.h.participationQR(f.req("first"));
  const ticket = await f.lookup(qr.payload);
  assert.equal(
    f.records.get("events/assembly/registrations/first").timeInAtMs,
    undefined,
  );
  assert.equal(ticket.student.studentId, "990001");
  const result = await f.confirm(ticket);
  assert.equal(result.timeInAtMs, f.now);
  assert.equal(result.timeInOfficerUid, "operator");
  await f.confirm(ticket);
  assert.equal(
    [...f.records.keys()].filter((path) => path.includes("/attendance_audit/"))
      .length,
    1,
  );
  f.advance(3000);
  const out = await f.lookup(qr.payload, "out");
  const completed = await f.confirm(out);
  assert.equal(completed.status, "Completed");
  assert.equal(completed.durationMs, 3000);
});
test("two officers scanning simultaneously cannot duplicate or overwrite time-in", async () => {
  const f = participationFixture();
  f.records.set("users/operator2", { ...f.records.get("users/operator") });
  await f.register("first");
  const qr = await f.h.participationQR(f.req("first"));
  const [one, two] = await Promise.all([
    f.lookup(qr.payload),
    f.lookup(qr.payload, "in", "operator2"),
  ]);
  const results = await Promise.allSettled([
    f.confirm(one),
    f.confirm(two, "operator2"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    [...f.records.keys()].filter((path) => path.includes("/attendance_audit/"))
      .length,
    1,
  );
});
for (const issue of [
  "unregistered",
  "out without in",
  "invalid QR",
  "read only",
  "student scan",
  "no identity confirmation",
  "expired confirmation",
  "wrong officer",
  "closed schedule",
  "retired student",
  "permission revoked",
])
  test("attendance rejects " + issue, async () => {
    const f = participationFixture();
    const qr = await f.h.participationQR(f.req("first"));
    if (issue === "unregistered") {
      await assert.rejects(f.lookup(qr.payload), /not registered/);
      return;
    }
    await f.register("first");
    if (issue === "out without in") {
      await assert.rejects(f.lookup(qr.payload, "out"), /without checking in/);
      return;
    }
    if (issue === "invalid QR") {
      await assert.rejects(f.lookup("990001"));
      return;
    }
    if (issue === "read only") {
      f.records.get("users/operator").officerPermissions = [];
      await assert.rejects(f.lookup(qr.payload));
      return;
    }
    if (issue === "student scan") {
      await assert.rejects(f.lookup(qr.payload, "in", "first"));
      return;
    }
    if (issue === "closed schedule") {
      f.advance(10001);
      await assert.rejects(f.lookup(qr.payload), /closed/);
      return;
    }
    if (issue === "retired student") {
      f.records.get("users/first").accountRemoved = true;
      await assert.rejects(f.lookup(qr.payload));
      return;
    }
    const ticket = await f.lookup(qr.payload);
    if (issue === "no identity confirmation") {
      await assert.rejects(
        f.h.participationConfirm(
          f.req("operator", { confirmation: ticket.confirmation }),
        ),
      );
      return;
    }
    if (issue === "expired confirmation") f.advance(120001);
    if (issue === "wrong officer") {
      await assert.rejects(f.confirm(ticket, "first"));
      return;
    }
    if (issue === "permission revoked")
      f.records.get("users/operator").officerPermissions = [];
    await assert.rejects(f.confirm(ticket));
    assert.equal(
      f.records.get("events/assembly/registrations/first").timeInAtMs,
      undefined,
    );
  });
test("absence and incomplete status are derived only after monitoring closes", () => {
  const event = { timeOutClosesAtMs: 2000 },
    registered = { registeredAtMs: 1000, attendanceClosesAtMs: 2000 },
    checked = { ...registered, timeInAtMs: 1100 };
  assert.equal(participationStatus(null, event, 3000), "Not Registered");
  assert.equal(participationStatus(registered, event, 1999), "Registered");
  assert.equal(participationStatus(registered, event, 2000), "Absent");
  assert.equal(participationStatus(checked, event, 1999), "Checked In");
  assert.equal(participationStatus(checked, event, 2000), "Incomplete");
  assert.equal(
    participationStatus({ ...checked, timeOutAtMs: 1500 }, event, 3000),
    "Completed",
  );
  assert.equal(
    participationStatus(
      { registeredAtMs: 1000 },
      { eventDate: "2000-01-01" },
      3000,
    ),
    "Registered",
    "legacy registrations without attendance monitoring are not invented absences",
  );
});
test("program registration and snapshot history use immutable UID", async () => {
  const f = participationFixture();
  await f.h.participationRegister(
    f.req("first", { source: "programs", eventId: "service" }),
  );
  f.records.get("users/first").program = "Changed program";
  f.records.get("users/second").studentId = "990001";
  const first = await f.h.participationHistory(f.req("first"));
  const second = await f.h.participationHistory(f.req("second"));
  assert.equal(first.rows.length, 1);
  assert.equal(
    first.rows[0].academicSnapshot.program,
    "Bachelor of Science in Information Technology",
  );
  assert.equal(second.rows.length, 0);
});
test("roster counters distinguish registration from attendance and unregistered students are derived", async () => {
  const f = participationFixture();
  await f.register("first");
  await f.register("second");
  const qr = await f.h.participationQR(f.req("first"));
  await f.confirm(await f.lookup(qr.payload));
  const page = await f.h.participationRoster(f.req("operator"));
  assert.deepEqual(page.totals, {
    registered: 2,
    checkedIn: 1,
    checkedOut: 0,
    completed: 0,
    incomplete: 0,
    absent: 0,
  });
  const notRegistered = await f.h.participationRoster(
    f.req("operator", { unregistered: true }),
  );
  assert.equal(notRegistered.rows.length, 1);
  assert.equal(notRegistered.rows[0].uid, "other");
  f.advance(20000);
  const closed = await f.h.participationRoster(f.req("operator"));
  assert.equal(closed.totals.absent, 1);
  assert.equal(closed.totals.incomplete, 1);
  assert.equal(closed.totals.checkedIn, 0);
});
test("new attendance schedule validates all groups and date ordering", () => {
  const f = participationFixture();
  assert.equal(
    validateParticipationSchedule(f.schedule).registrationMode,
    "internal",
  );
  assert.throws(() =>
    validateParticipationSchedule({
      ...f.schedule,
      timeOutClosesAtMs: f.now - 1,
    }),
  );
  assert.throws(() =>
    validateParticipationSchedule({
      ...f.schedule,
      targetParticipants: { section: [1] },
    }),
  );
  assert.equal(
    eligibleForEvent(
      { targetParticipants: { program: ["Other"] } },
      academicSnapshot(f.records.get("users/first")),
    ),
    false,
  );
});
test("database failure produces no success, record or audit mutation", async () => {
  const f = participationFixture();
  await f.register("first");
  const qr = await f.h.participationQR(f.req("first"));
  const ticket = await f.lookup(qr.payload);
  f.db.runTransaction = async () => {
    throw Error("Database unavailable");
  };
  await assert.rejects(f.confirm(ticket));
  assert.equal(
    f.records.get("events/assembly/registrations/first").timeInAtMs,
    undefined,
  );
});
test("attendance ignores client timestamps and binds confirmation to its event and officer", async () => {
  const f = participationFixture();
  await f.register("first");
  const qr = await f.h.participationQR(f.req("first"));
  const ticket = await f.lookup(qr.payload);
  await assert.rejects(
    f.h.participationConfirm(
      f.req("operator", {
        source: "programs",
        eventId: "service",
        confirmation: ticket.confirmation,
        identityConfirmed: true,
      }),
    ),
    { code: "permission-denied" },
  );
  const record = await f.h.participationConfirm(
    f.req("operator", {
      confirmation: ticket.confirmation,
      identityConfirmed: true,
      timeInAtMs: 1,
      studentUid: "other",
    }),
  );
  assert.equal(record.timeInAtMs, f.now);
  assert.equal(record.studentUid, "first");
});
test("new QR and history do not transfer when a visible Student ID is reassigned", async () => {
  const f = participationFixture();
  await f.register("first");
  const old = await f.h.participationQR(f.req("first"));
  f.records.get("users/first").accountRemoved = true;
  f.records.get("users/other").studentId = "990001";
  const replacement = await f.h.participationQR(f.req("other"));
  assert.notEqual(old.payload, replacement.payload);
  await assert.rejects(f.lookup(old.payload));
  assert.equal((await f.h.participationHistory(f.req("other"))).rows.length, 0);
});
test("students cannot retrieve another student participation or officer roster", async () => {
  const f = participationFixture();
  await assert.rejects(
    f.h.participationHistory(f.req("first", { studentUid: "second" })),
  );
  await assert.rejects(f.h.participationRoster(f.req("first")));
});
test("published events use configured participation schedules and lock them after registration", async () => {
  const f = participationFixture();
  const {
    createOfficerModuleHandlers,
  } = require("../server/officer-modules.cjs");
  const h = createOfficerModuleHandlers({
    db: f.db,
    history: f.history,
    ...f.authorization,
    Timestamp: { fromMillis: (value) => value },
    clock: () => f.now,
  });
  const input = {
    title: "New Assembly",
    venue: "Campus",
    description: "An internal event",
    eventDate: new Date(f.now).toISOString().slice(0, 10),
    startTime: "08:00",
    endTime: "18:00",
    registrationDeadlineMs: f.schedule.registrationClosesAtMs,
    ...f.schedule,
  };
  await h.officerModuleAction(
    f.req("operator", {
      module: "events",
      action: "publish",
      operationId: "new-assembly",
      input,
    }),
  );
  assert.equal(f.records.get("events/new-assembly").participationVersion, 1);
  const {createEligibilityHandlers}=require('../server/reporting-eligibility.cjs');
  const capture=createEligibilityHandlers({db:f.db,history:f.history,...f.authorization,clock:()=>f.now});
  await capture.reportingCaptureEligibility(f.req('operator',{source:'events',eventId:'new-assembly'}));
  await f.h.participationRegister(f.req("first", { eventId: "new-assembly" }));
  await assert.rejects(
    h.officerModuleAction(
      f.req("operator", {
        module: "events",
        action: "update",
        recordId: "new-assembly",
        operationId: "change-window",
        input: { ...input, timeOutClosesAtMs: f.now + 30000 },
      }),
    ),
    /locked/,
  );
});
test("participation pages retain snapshot filters and cannot cross the officer source permission", async () => {
  const f = participationFixture();
  await f.register("first");
  await f.h.participationRegister(
    f.req("first", { source: "programs", eventId: "service" }),
  );
  f.records.get("users/first").program = "New program";
  const page = await f.h.participationStudents(
    f.req("operator", { view: "participation" }),
  );
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].eventSnapshot.title, "Synthetic General Assembly");
  assert.equal(
    page.rows[0].program,
    "Bachelor of Science in Information Technology",
  );
  f.records.get("users/operator").officerPermissions = ["events.manage"];
  await assert.rejects(
    f.h.participationStudents(
      f.req("operator", { view: "participation", source: "programs" }),
    ),
  );
  await assert.rejects(
    f.h.participationStudents(f.req("first", { view: "participation" })),
  );
});
test("student directory, participation and history pagination do not omit or duplicate boundary records", async () => {
  const f = participationFixture();
  for (let index = 0; index < 55; index++) {
    const uid = "page-" + String(index).padStart(3, "0");
    f.records.set("users/" + uid, {
      ...f.records.get("users/first"),
      studentId: uid,
    });
    f.records.set("events/assembly/registrations/" + uid, {
      studentUid: uid,
      studentId: uid,
      registeredAtMs: f.now,
    });
  }
  const one = await f.h.participationStudents(
    f.req("operator", { view: "participation" }),
  );
  const two = await f.h.participationStudents(
    f.req("operator", { view: "participation", after: one.next }),
  );
  assert.equal(one.rows.length, 50);
  assert.equal(two.rows.length, 5);
  assert.equal(
    new Set([...one.rows, ...two.rows].map((row) => row.uid)).size,
    55,
  );
  assert.equal(two.next, null);
  for (let index = 0; index < 55; index++) {
    const id = "history-" + String(index).padStart(3, "0");
    f.records.set(`events/${id}/registrations/first`, {
      studentUid: "first",
      eventSnapshot: { title: id },
      registeredAtMs: f.now,
    });
  }
  const a = await f.h.participationHistory(f.req("first"));
  const b = await f.h.participationHistory(f.req("first", { after: a.next }));
  assert.equal(a.rows.length, 50);
  assert.equal(b.rows.length, 5);
  assert.equal(new Set([...a.rows, ...b.rows].map((row) => row.id)).size, 55);
});
test("new publications cannot bypass required internal schedules or downgrade configured events", async () => {
  const f = participationFixture(),
    { createOfficerModuleHandlers } = require("../server/officer-modules.cjs");
  const h = createOfficerModuleHandlers({
    db: f.db,
    history: f.history,
    ...f.authorization,
    Timestamp: { fromMillis: (value) => value },
    clock: () => f.now,
  });
  const input = {
    title: "Test",
    description: "Test",
    venue: "SSU",
    eventDate: "2026-12-01",
    registrationMode: "none",
  };
  await assert.rejects(
    h.officerModuleAction(
      f.req("operator", {
        module: "events",
        action: "publish",
        operationId: "missing-schedules",
        input,
      }),
    ),
    /Configure internal/,
  );
  await assert.rejects(
    h.officerModuleAction(
      f.req("operator", {
        module: "events",
        action: "update",
        recordId: "assembly",
        operationId: "downgrade",
        input,
      }),
    ),
    /Configure internal/,
  );
});
test("adding attendance schedules does not invent absence for legacy registration records", async () => {
  const f = participationFixture();
  f.records.set("events/assembly/registrations/first", {
    studentUid: "first",
    registeredAtMs: f.now,
    studentId: "990001",
  });
  await f.register("second");
  f.advance(20000);
  const legacy = await f.h.participationHistory(f.req("first"));
  assert.equal(legacy.rows[0].status, "Registered");
  const roster = await f.h.participationRoster(f.req("operator"));
  assert.equal(roster.totals.registered, 2);
  assert.equal(roster.totals.absent, 1);
});
test("registration and attendance validate and stamp the same trusted instant at closing boundaries", async () => {
  const f = participationFixture(),
    {
      createEventParticipationHandlers,
    } = require("../server/event-participation.cjs");
  let timestamp = f.now;
  const h = createEventParticipationHandlers({
    db: f.db,
    ...f.authorization,
    history: f.history,
    clock: () => timestamp++,
  });
  f.records.get("events/assembly").registrationClosesAtMs = f.now + 1;
  const registration = await h.participationRegister(f.req("first"));
  assert.equal(registration.registeredAtMs, f.now);
  assert.equal(
    registration.registeredAt.getTime(),
    registration.registeredAtMs,
  );
  const qr = await f.h.participationQR(f.req("first")),
    ticket = await f.lookup(qr.payload);
  timestamp = f.now;
  f.records.get("events/assembly").timeInClosesAtMs = f.now + 2;
  const attendance = await h.participationConfirm(
    f.req("operator", {
      confirmation: ticket.confirmation,
      identityConfirmed: true,
    }),
  );
  assert.ok(attendance.timeInAtMs < f.now + 2);
});
