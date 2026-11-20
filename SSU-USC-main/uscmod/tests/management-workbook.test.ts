import {
  parseFile,
  validateWorkbookArchive,
} from "../supabase/functions/usc-management/workbook.ts";
import ExcelJS from "npm:exceljs@4.4.0";
import { IMPORT_HEADERS } from "../shared/student-import-model.mjs";
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw Error(message);
};
async function rejects(fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
  } catch (error) {
    assert(pattern.test(String(error)), String(error));
    return;
  }
  throw Error("Expected rejection.");
}
const file = (name: string, bytes: Uint8Array) => ({
  name,
  base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")),
});
async function workbook(studentId: unknown = "000123", formula = false) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Students");
  sheet.addRow(IMPORT_HEADERS);
  sheet.addRow([
    studentId,
    "Sample Student",
    "College of Engineering",
    "Bachelor of Science in Computer Engineering",
    "2",
    "",
    "2026–2027",
    "Active",
  ]);
  if (formula) sheet.getCell("B2").value = { formula: "1+1", result: 2 };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
Deno.test(
  "CSV upload preserves Student IDs and enforces file boundaries",
  async () => {
    const rows = await parseFile(
      file(
        "students.csv",
        new TextEncoder().encode("Student ID,Name\n000123,Sample"),
      ),
    );
    assert(rows[1][0] === "000123");
    await rejects(
      () => parseFile(file("students.exe", new Uint8Array([1]))),
      /CSV and XLSX/,
    );
    await rejects(
      () => parseFile({ name: "students.csv", base64: "x".repeat(7000001) }),
      /5 MB/,
    );
  },
);
Deno.test(
  "XLSX upload preserves text IDs and rejects numeric IDs and formulas",
  async () => {
    const rows = await parseFile(file("students.xlsx", await workbook()));
    assert(rows[1][0] === "000123");
    assert(rows[0][0] === "Student ID");
    await rejects(
      async () => parseFile(file("students.xlsx", await workbook(123))),
      /as Text/,
    );
    await rejects(
      async () =>
        parseFile(file("students.xlsx", await workbook("000123", true))),
      /Formulas/,
    );
  },
);
Deno.test(
  "XLSX archive guard rejects excessive expansion and corrupt archives",
  () => {
    let failed = false;
    try {
      validateWorkbookArchive(new Uint8Array([1, 2, 3]));
    } catch {
      failed = true;
    }
    assert(failed);
    const bytes = new Uint8Array(46),
      view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, 33 * 1024 * 1024, true);
    failed = false;
    try {
      validateWorkbookArchive(bytes);
    } catch {
      failed = true;
    }
    assert(failed);
  },
);
