import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as m from "../shared/reporting-model.mjs";
import { allPages } from "../shared/reporting-data.mjs";
import { buildReportingWorkbook } from "../shared/reporting-export.mjs";
const require = createRequire(import.meta.url),
  ExcelJS = require("../vendor/exceljs/exceljs-4.4.0.min.js");
const event = {
  id: "assembly",
  source: "events",
  title: "General Assembly",
  timeOutClosesAtMs: 2000,
};
function dataset(n = 200) {
  const population = Array.from({ length: n }, (_, i) => ({
    uid: "u" + i,
    studentId: String(i).padStart(6, "0"),
    fullName: i === 0 ? "=1+1" : "Student " + i,
    college: i < 100 ? "CAS" : "CONHS",
    program: "BSIT",
    yearLevel: "4th Year",
    section: i % 2 ? "4A" : "4B",
  }));
  const registrations = population.slice(0, 150).map((p, i) => ({
    ...p,
    studentUid: p.uid,
    schemaVersion: 1,
    registeredAtMs: 100,
    timeInAtMs: i < 120 ? 500 : null,
    timeOutAtMs: i < 100 ? 1500 : null,
    attendanceClosesAtMs: 2000,
  }));
  return { population, registrations };
}
test("canonical 200 eligible / 150 registered / 120 attendees / 100 completed uses the correct denominators", () => {
  const d = dataset(),
    rows = m.attendanceRows(event, d.population, d.registrations, 3000, true),
    s = m.attendanceStatistics(rows, { complete: true, closed: true });
  assert.equal(s.eligible, 200);
  assert.equal(s.registered, 150);
  assert.equal(s.attended, 120);
  assert.equal(s.completed, 100);
  assert.equal(s.incomplete, 20);
  assert.equal(s.absent, 30);
  assert.equal(s.unregistered, 50);
  assert.equal(s.participationRate, 60);
  assert.equal(s.registrationRate, 75);
  assert.equal(s.attendanceRate, 80);
  assert.equal(m.percentage(s.completionRate), "83.33%");
  assert.equal(s.absenceRate, 20);
});
test("pending windows do not prematurely count absent/incomplete; legacy denominators and zero denominator are unavailable", () => {
  const d = dataset();
  const rows = m.attendanceRows(
      event,
      d.population,
      d.registrations,
      1000,
      true,
    ),
    s = m.attendanceStatistics(rows);
  assert.equal(s.checkedIn, 20);
  assert.equal(s.absent, 0);
  assert.equal(s.incomplete, 0);
  assert.equal(s.absenceRate, null);
  assert.equal(m.attendanceStatistics([]).participationRate, null);
  const legacy = m.attendanceStatistics(
    m.attendanceRows(event, [], d.registrations, 3000, false),
    { complete: false, closed: true },
  );
  assert.equal(legacy.eligible, null);
  assert.equal(legacy.participationRate, null);
});
test("UID/event de-duplication and weighted multi-event counts distinguish unique students", () => {
  const d = dataset(),
    a = m.attendanceRows(event, d.population, d.registrations, 3000),
    b = m.attendanceRows(
      { ...event, id: "second" },
      d.population,
      d.registrations.slice(0, 50),
      3000,
    );
  const s = m.attendanceStatistics([...a, ...a, ...b], { closed: true });
  assert.equal(s.eligible, 400);
  assert.equal(s.registered, 200);
  assert.equal(s.attended, 170);
  assert.equal(s.uniqueAttendees, 120);
  assert.equal(s.participationRate, 42.5);
});
test("captured academics survive profile changes and registration copies; corrupt cohort cannot silently drop registered UIDs", () => {
  const d = dataset();
  d.registrations[0].academicSnapshot = { program: "NEW PROGRAM" };
  const rows = m.attendanceRows(event, d.population, d.registrations, 3000);
  assert.equal(rows[0].program, "BSIT");
  assert.throws(
    () => m.attendanceRows(event, [], d.registrations, 3000, true),
    /incomplete/,
  );
  assert.equal(
    m.attendanceView(
      rows,
      { college: "CONHS", section: "4A" },
      { closed: true },
    ).rows.length,
    50,
  );
});
test("complaint closure does not imply resolution and averages exclude absent or invalid timestamps", () => {
  const rows = [
    { status: "Resolved", createdAtMs: 100, resolvedAtMs: 300 },
    {
      status: "Closed",
      resolutionOutcome: "resolved",
      createdAtMs: 100,
      resolvedAtMs: 500,
    },
    { status: "Closed", createdAtMs: 100 },
    { status: "Resolved", createdAtMs: 200, resolvedAtMs: 100 },
    { status: "Submitted" },
  ];
  const s = m.complaintMetrics(rows, 1000);
  assert.equal(s.resolved, 3);
  assert.equal(s.resolutionRate, 60);
  assert.equal(s.averageResolutionMs, 300);
  assert.equal(s.resolutionSamples, 2);
  assert.equal(
    m.complaintMatches({ createdAtMs: null }, { from: "2026-01-01" }),
    false,
  );
  assert.equal(m.ratio(0, 0), null);
});
test("paginated retrieval loads all authorized pages and refuses cyclic cursors / explicit limits", async () => {
  let calls = 0;
  const d = await allPages(async (_, p) => {
    calls++;
    return { rows: [p.after || "first"], next: p.after ? null : "second" };
  }, {});
  assert.equal(calls, 2);
  assert.deepEqual(d.rows, ["first", "second"]);
  await assert.rejects(
    allPages(async () => ({ rows: [1], next: "same" }), {}),
    /did not advance/,
  );
  await assert.rejects(
    allPages(async () => ({ rows: [1, 2], next: null }), {}, { maximum: 1 }),
    /exceeds/,
  );
});
test("genuine Excel workbook round-trips IDs, literal formula-like names, actual dates, numeric durations and percentages", async () => {
  const d = dataset(),
    rows = m.attendanceRows(event, d.population, d.registrations, 3000),
    book = buildReportingWorkbook(ExcelJS, {
      type: "attendance",
      rows,
      context: "University-wide",
      actor: "Officer",
      atMs: Date.now(),
      complete: true,
      closed: true,
    }),
    bytes = await book.xlsx.writeBuffer();
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(bytes);
  const ws = read.getWorksheet("Individual Attendance Records");
  assert.equal(ws.rowCount, 206);
  const first = ws.getRows(7, 200).find((r) => r.getCell(2).value === "000000");
  assert.ok(first);
  assert.equal(first.getCell(3).value, "=1+1");
  assert.equal(first.getCell(3).type, 3);
  assert.ok(first.getCell(9).value instanceof Date);
  assert.equal(
    typeof book
      .getWorksheet("Individual Attendance Records")
      .getCell(first.number, 12).value,
    "number",
  );
  assert.ok(first.getCell(12).value instanceof Date);
  assert.equal(first.getCell(12).numFmt, "[h]:mm");
  assert.equal(
    read.getWorksheet("Attendance Summary").getCell("B14").value,
    0.6,
  );
  assert.equal(ws.views[0].ySplit, 6);
  assert.ok(ws.autoFilter);
});
test("aggregate Excel excludes individual records; complaint exports omit identities and descriptions; oversized export is rejected", async () => {
  const book = buildReportingWorkbook(ExcelJS, {
    type: "complaints",
    rows: [
      {
        status: "Closed",
        subject: "Visible",
        studentName: "SECRET",
        details: "SECRET",
        college: "CAS",
      },
    ],
    context: "All",
    actor: "Officer",
    atMs: Date.now(),
    details: false,
  });
  assert.equal(book.getWorksheet("Complaint Records"), undefined);
  assert.ok(!JSON.stringify(book.model).includes("SECRET"));
  assert.throws(
    () =>
      buildReportingWorkbook(ExcelJS, {
        type: "activities",
        rows: Array(10001).fill({}),
        atMs: Date.now(),
      }),
    /10,000/,
  );
});
const { participationFixture } = require("./helpers/participation-fixture.cjs");
const { createReportingHandlers } = require("../server/reporting.cjs");
const {
  createEligibilityHandlers,
} = require("../server/reporting-eligibility.cjs");
function fixture() {
  const f = participationFixture();
  const p = f.records.get("users/operator");
  p.officerPermissions.push(
    "reports.generate",
    "complaints.view",
    "complaints.report",
  );
  const dependencies = {
    db: f.db,
    history: f.history,
    ...f.authorization,
    clock: () => f.now,
  };
  return Object.assign(f, {
    reports: createReportingHandlers(dependencies),
    capture: createEligibilityHandlers(dependencies),
  });
}
test("report endpoints deny students and missing reporting permissions; aggregate roles never receive student identities", async () => {
  const f = fixture();
  await assert.rejects(
    f.reports.reportingCapabilities(f.req("first")),
    /authorized|permission/,
  );
  const p = f.records.get("users/operator");
  p.officerPermissions = ["reports.generate"];
  await f.register("first");
  const r = await f.reports.reportingPage(
    f.req("operator", {
      section: "attendance",
      source: "events",
      eventId: "assembly",
      phase: "registrations",
    }),
  );
  assert.equal(r.mayViewRecords, false);
  assert.equal(r.rows[0].fullName, undefined);
  assert.notEqual(r.rows[0].studentUid, "first");
  assert.equal(r.rows[0].studentId, undefined);
  await assert.rejects(
    f.reports.reportingExportAudit(
      f.req("operator", {
        type: "attendance",
        events: [{ source: "events", eventId: "assembly" }],
        operationId: "export",
      }),
    ),
    /not assigned/,
  );
  await assert.rejects(
    f.reports.reportingPage(f.req("operator", { section: "complaints" })),
    /not assigned/,
  );
});
test("complaint aggregate permissions exclude subject, reference, identity, detail and attachment fields", async () => {
  const f = fixture();
  f.records.set("complaints/case", {
    status: "Submitted",
    studentDepartment: "CAS",
    complaintRef: "USC-001",
    subject: "Secret subject",
    studentName: "Secret student",
    details: "PRIVATE",
    attachmentPath: "PRIVATE",
    createdAt: f.now,
    updatedAt: f.now,
  });
  const r = await f.reports.reportingPage(
    f.req("operator", { section: "complaints" }),
  );
  assert.equal(r.rows[0].college, "CAS");
  assert.equal(r.rows[0].subject, "");
  assert.equal(r.rows[0].reference, "");
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  await assert.rejects(
    f.reports.reportingPage(
      f.req("operator", {
        section: "complaints",
        filters: { search: "Secret" },
      }),
    ),
    /not authorized/,
  );
});
test("private eligibility capture is cursor-safe, resumable, idempotent and preserves original academic classification", async () => {
  const f = fixture();
  f.records.set("reporting_eligibility/snapshot", {
    source: "events",
    eventId: "assembly",
    state: "pending",
    next: null,
    page: 0,
    count: 0,
    scanned: 0,
    targetParticipants: f.records.get("events/assembly").targetParticipants,
    eventDate: f.records.get("events/assembly").eventDate,
  });
  Object.assign(f.records.get("events/assembly"), {
    eligibilityPolicyVersion: 1,
    eligibilitySnapshotId: "snapshot",
    eligibilitySnapshotState: "pending",
  });
  await assert.rejects(f.register("first"), /prepared/);
  const [a, b] = await Promise.all([
    f.capture.reportingCaptureEligibility(f.req("operator")),
    f.capture.reportingCaptureEligibility(f.req("operator")),
  ]);
  assert.equal(a.state, "ready");
  assert.equal(b.count, 3);
  assert.equal(
    [...f.records.keys()].filter((k) => k.includes("/chunks/")).length,
    1,
  );
  const original = f.records.get("users/first").section;
  f.records.get("users/first").section = "NEW";
  await f.register("first");
  assert.equal(
    f.records.get("events/assembly/registrations/first").academicSnapshot
      .section,
    original,
  );
  const report = await f.reports.reportingPage(
    f.req("operator", { section: "attendance", phase: "population" }),
  );
  assert.equal(report.rows.find((r) => r.uid === "first").section, original);
});
test("exports validate parameters, bind retries to one report and restrict activity ownership", async () => {
  const f = fixture();
  const data = { type: "activities", operationId: "one", filters: {} };
  await f.reports.reportingExportAudit(f.req("operator", data));
  await f.reports.reportingExportAudit(f.req("operator", data));
  assert.equal(
    [...f.records.keys()].filter((k) => k.startsWith("reporting_audit/"))
      .length,
    1,
  );
  await assert.rejects(
    f.reports.reportingExportAudit(
      f.req("operator", { ...data, filters: { from: "2026-01-01" } }),
    ),
    /bound/,
  );
  await assert.rejects(
    f.reports.reportingPage(
      f.req("operator", {
        section: "activities",
        phase: "officers",
        filters: { officer: "other" },
      }),
    ),
    /own officer/,
  );
  await assert.rejects(
    f.reports.reportingPage(
      f.req("operator", {
        section: "catalog",
        filters: { from: "2026-99-99" },
      }),
    ),
    /date/,
  );
  await assert.rejects(
    f.reports.reportingPage(
      f.req("operator", { section: "catalog", filters: { unexpected: "x" } }),
    ),
    /filters/,
  );
});
test("new-policy eligibility stays consistent across registration, student Tracklist and officer roster after a section change", async () => {
  const f = fixture(),
    event = f.records.get("events/assembly");
  Object.assign(event, {
    eligibilityPolicyVersion: 1,
    eligibilitySnapshotId: "frozen",
    eligibilitySnapshotState: "pending",
    targetParticipants: { section: ["4A"] },
  });
  f.records.set("reporting_eligibility/frozen", {
    source: "events",
    eventId: "assembly",
    state: "pending",
    next: null,
    page: 0,
    count: 0,
    scanned: 0,
    targetParticipants: event.targetParticipants,
    eventDate: event.eventDate,
  });
  await f.capture.reportingCaptureEligibility(f.req("operator"));
  f.records.get("users/first").section = "5A";
  const state = await f.h.participationEligible(f.req("first"));
  assert.equal(state.state, "Register");
  const eligible = await f.h.participationEligible(
    f.req("first", { eventId: undefined }),
  );
  assert.equal(
    eligible.rows.find((r) => r.eventId === "assembly").section,
    "4A",
  );
  const roster = await f.h.participationRoster(
    f.req("operator", { unregistered: true }),
  );
  assert.equal(roster.rows.find((r) => r.uid === "first").section, "4A");
  // A newly created account cannot inherit another UID's captured eligibility.
  f.seed({
    uid: "new-student",
    role: "student",
    studentId: "123456",
    fullName: "New student",
    accountStatus: "approved",
    isActive: true,
    schoolProvisioned: true,
    studentStanding: "active",
    college: "College of Arts and Sciences",
    program: "Bachelor of Science in Information Technology",
    yearLevel: "4th Year",
    section: "4A",
  });
  assert.equal(
    (await f.h.participationEligible(f.req("new-student"))).state,
    "Not Eligible",
  );
  await assert.rejects(
    f.h.participationRegister(f.req("new-student")),
    /saved eligible population/,
  );
  await f.register("first");
  assert.equal(
    f.records.get("events/assembly/registrations/first").academicSnapshot
      .section,
    "4A",
  );
});
test("staging setup refuses production credentials and preserves all existing field indexes", () => {
  const {
    verifyAccount,
    mergeFieldIndexes,
    composites,
    fields,
  } = require("../scripts/prepare-reporting-staging-indexes.cjs");
  assert.throws(
    () =>
      verifyAccount({
        type: "service_account",
        project_id: "universitystudentcouncil-856cc",
      }),
    /Only/,
  );
  assert.doesNotThrow(() =>
    verifyAccount({
      type: "service_account",
      project_id: "ssu-usc-email-staging",
    }),
  );
  const original = [
      {
        fields: [{ fieldPath: "officerUid", order: "DESCENDING" }],
        queryScope: "COLLECTION_GROUP",
        state: "READY",
      },
      {
        fields: [{ fieldPath: "officerUid", arrayConfig: "CONTAINS" }],
        queryScope: "COLLECTION",
      },
    ],
    merged = mergeFieldIndexes(original, fields[0].indexes);
  assert.deepEqual(merged.slice(0, 2), original);
  assert.equal(composites.length, 3);
  assert.equal(
    mergeFieldIndexes(merged, fields[0].indexes).length,
    merged.length,
  );
});
