import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  filterParticipation,
  collectParticipation,
  buildParticipationWorkbook,
} from "../shared/participation-export.mjs";
const require = createRequire(import.meta.url),
  ExcelJS = require("../vendor/exceljs/exceljs-4.4.0.min.js");
const rows = [
  {
    studentId: "000123",
    fullName: '=HYPERLINK("bad")',
    program: "BSIT",
    yearLevel: "4th Year",
    section: "4A",
    status: "Completed",
    registeredAtMs: 1000,
    timeInAtMs: 2000,
    timeOutAtMs: 62000,
    durationMs: 60000,
  },
  {
    studentId: "000124",
    program: "BSIT",
    yearLevel: "3rd Year",
    section: "3A",
    status: "Absent",
  },
  {
    studentId: "000125",
    program: "Other",
    yearLevel: "4th Year",
    section: "4A",
    status: "Registered",
  },
];
test("academic filters combine and Overall preserves every participant", () => {
  assert.equal(filterParticipation(rows).length, 3);
  assert.deepEqual(
    filterParticipation(rows, {
      program: "BSIT",
      yearLevel: "4th Year",
      section: "4A",
    }),
    [rows[0]],
  );
  assert.equal(
    filterParticipation(rows, { program: "Other", section: "3A" }).length,
    0,
  );
  assert.equal(
    filterParticipation([{ ...rows[0], section: "" }], {
      section: "__missing__",
    }).length,
    1,
  );
});
test("export collects all pages, including matching records beyond the first page", async () => {
  const pages = [
      { rows: rows.slice(0, 1), next: "next" },
      { rows: rows.slice(1), next: null },
    ],
    calls = [];
  const all = await collectParticipation(async (after) => {
    calls.push(after);
    return pages.shift();
  });
  assert.deepEqual(calls, [null, "next"]);
  assert.equal(filterParticipation(all, { program: "Other" }).length, 1);
});
test("failed, closed or cyclic pagination never produces a partial completed export", async () => {
  await assert.rejects(
    collectParticipation(async () => {
      throw Error("Database offline");
    }),
    /offline/,
  );
  await assert.rejects(
    collectParticipation(
      async () => ({ rows, next: null }),
      () => {},
      () => false,
    ),
    /closed/,
  );
  await assert.rejects(
    collectParticipation(async () => ({ rows: [], next: "same" })),
    /did not advance/,
  );
});
test("real Excel workbook preserves IDs as text, safely stores formula-like names and computes filtered summaries", async () => {
  const book = buildParticipationWorkbook(ExcelJS, {
    event: { title: "Test event", eventDate: "2026-11-28" },
    rows,
    filters: { program: "BSIT" },
    generatedAt: 1000,
  });
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await book.xlsx.writeBuffer());
  assert.deepEqual(
    copy.worksheets.map((s) => s.name),
    ["Summary", "Attendance", "By academic group"],
  );
  const attendance = copy.getWorksheet("Attendance");
  assert.equal(attendance.rowCount, 3);
  assert.equal(attendance.getCell("A2").value, "000123");
  assert.equal(attendance.getCell("B2").value, rows[0].fullName);
  assert.equal(attendance.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(attendance.getCell("J2").value, 1);
  assert.equal(attendance.getCell("K3").value, "Absent");
  assert.equal(copy.getWorksheet("Summary").getCell("B8").value, 2);
  assert.equal(copy.getWorksheet("Summary").getCell("B15").value, 0.5);
  assert.equal(copy.getWorksheet("By academic group").rowCount, 3);
  assert.equal(attendance.getCell("H2").value.includes("1970"), true);
});
test("zero matching records produce a valid empty workbook and zero completion rate", async () => {
  const book = buildParticipationWorkbook(ExcelJS, {
    event: { title: "Empty" },
    rows,
    filters: { program: "Missing" },
  });
  assert.equal(book.getWorksheet("Attendance").rowCount, 1);
  assert.equal(book.getWorksheet("Summary").getCell("B15").value, 0);
  await book.xlsx.writeBuffer();
});
