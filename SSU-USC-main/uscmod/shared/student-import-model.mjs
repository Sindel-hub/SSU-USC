import { SSU_PROGRAMS } from "../usc-admin/student-registration/js/ssu-programs.js";
export const IMPORT_HEADERS = [
  "Student ID",
  "Full Name",
  "Department",
  "Program/Course",
  "Year Level",
  "Email Address",
  "Academic Year",
  "Student Status",
];
export function parseCsv(source) {
  source = source.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && source[i + 1] === "\n") i++;
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      }
    } else {
      if (closed || c === '"') throw Error("Malformed CSV quoting.");
      cell += c;
    }
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}
export function validateStudentRows(table) {
  if (!Array.isArray(table) || table.length < 2 || table.length > 5001)
    throw Error("Import 1–5,000 records per file.");
  if (JSON.stringify(table[0]) !== JSON.stringify(IMPORT_HEADERS))
    throw Error("Use the exact column headings from the sample template.");
  if (
    table.some(
      (row) =>
        !Array.isArray(row) ||
        row.some((cell) => typeof cell !== "string" || cell.length > 500),
    )
  )
    throw Error("Cells must contain plain text of at most 500 characters.");
  const seen = new Set();
  return table.slice(1).map((cells, i) => {
    const errors = [];
    const [
      studentId,
      fullName,
      college,
      program,
      year,
      email,
      academicYear,
      status,
    ] = cells.map((v) => (typeof v === "string" ? v.trim() : ""));
    if (cells.length !== 8) errors.push("Expected eight columns.");
    if (!/^[0-9]{1,64}$/.test(studentId || ""))
      errors.push(
        "Student ID must be text containing digits only, up to 64 digits.",
      );
    if (seen.has(studentId)) errors.push("Duplicate Student ID in file.");
    seen.add(studentId);
    if (!fullName || fullName.length < 2 || fullName.length > 120)
      errors.push("Full name must have 2–120 characters.");
    if (!SSU_PROGRAMS[college]?.includes(program))
      errors.push("Department/program does not match the SSU catalog.");
    const yearLevel =
      {
        1: "1st Year",
        2: "2nd Year",
        3: "3rd Year",
        4: "4th Year",
        5: "5th Year",
      }[year] || year;
    if (
      !["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"].includes(
        yearLevel,
      )
    )
      errors.push("Year level must be 1–5.");
    if (
      email &&
      (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
        email.length > 200 ||
        email.endsWith(".local"))
    )
      errors.push("Invalid contact email.");
    if (
      !/^20[0-9]{2}–20[0-9]{2}$/.test((academicYear || "").replace("-", "–")) ||
      Number(academicYear?.slice(5)) - Number(academicYear?.slice(0, 4)) !== 1
    )
      errors.push("Academic year must be consecutive, e.g. 2026–2027.");
    const studentStanding = (status || "").toLowerCase();
    if (
      ![
        "active",
        "inactive",
        "graduated",
        "leave",
        "transferred",
        "withdrawn",
        "eliminated",
      ].includes(studentStanding)
    )
      errors.push("Unsupported student status.");
    return {
      row: i + 2,
      errors,
      data: {
        studentId,
        fullName,
        college,
        program,
        yearLevel,
        institutionalEmail: (email || "").toLowerCase(),
        academicYear: (academicYear || "").replace("-", "–"),
        studentStanding,
      },
    };
  });
}
