import {
  PARTICIPATION_STATUSES,
  manilaTime,
} from "./event-participation-model.mjs";
export function filterParticipation(rows, filters = {}) {
  return rows.filter((row) =>
    ["program", "yearLevel", "section"].every(
      (key) =>
        !filters[key] ||
        (filters[key] === "__missing__"
          ? !row[key]
          : row[key] === filters[key]),
    ),
  );
}
export async function collectParticipation(
  fetchPage,
  onProgress = () => {},
  isCurrent = () => true,
) {
  const rows = [],
    seen = new Set();
  let after = null;
  do {
    const page = await fetchPage(after);
    if (!isCurrent()) throw Error("Export closed.");
    rows.push(...page.rows);
    onProgress(rows.length);
    after = page.next;
    if (after && seen.has(after))
      throw Error("Pagination did not advance. Retry the export.");
    if (after) seen.add(after);
  } while (after);
  return rows;
}
export function buildParticipationWorkbook(
  ExcelJS,
  { event, rows, filters = {}, generatedAt = Date.now() },
) {
  const selected = filterParticipation(rows, filters),
    book = new ExcelJS.Workbook();
  book.creator = "SSU-USC";
  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 32 }, { width: 75 }];
  summary.addRows([
    ["Event participation analytics", event.title || "Event"],
    ["Event date", event.eventDate || ""],
    ["Generated (Asia/Manila)", manilaTime(generatedAt)],
    [
      "Program",
      filters.program === "__missing__"
        ? "Not recorded"
        : filters.program || "All programs",
    ],
    [
      "Year",
      filters.yearLevel === "__missing__"
        ? "Not recorded"
        : filters.yearLevel || "All years",
    ],
    [
      "Section",
      filters.section === "__missing__"
        ? "Not recorded"
        : filters.section || "All sections",
    ],
    ["Scope", "Registered participants; academic data saved at registration"],
    ["Matching registrations", selected.length],
  ]);
  for (const status of PARTICIPATION_STATUSES)
    summary.addRow([
      status,
      selected.filter((row) => row.status === status).length,
    ]);
  summary.addRow([
    "Completion rate",
    selected.length
      ? selected.filter((row) => row.status === "Completed").length /
        selected.length
      : 0,
  ]);
  summary.getCell(`B${summary.rowCount}`).numFmt = "0.0%";
  const details = book.addWorksheet("Attendance");
  details.columns = [
    ["Student ID", 20],
    ["Full name", 30],
    ["Department", 35],
    ["Program", 45],
    ["Year level", 16],
    ["Section", 16],
    ["Registered (Asia/Manila)", 30],
    ["Time-in (Asia/Manila)", 30],
    ["Time-out (Asia/Manila)", 30],
    ["Duration (minutes)", 22],
    ["Status", 20],
  ].map(([header, width]) => ({ header, width }));
  for (const row of selected)
    details.addRow([
      String(row.studentId || ""),
      String(row.fullName || ""),
      String(row.college || ""),
      String(row.program || ""),
      String(row.yearLevel || ""),
      String(row.section || ""),
      manilaTime(row.registeredAtMs),
      manilaTime(row.timeInAtMs),
      manilaTime(row.timeOutAtMs),
      row.durationMs == null
        ? null
        : Math.round((row.durationMs / 60000) * 100) / 100,
      row.status,
    ]);
  details.getColumn(1).numFmt = "@";
  details.autoFilter = { from: "A1", to: "K1" };
  details.views = [{ state: "frozen", ySplit: 1 }];
  const groups = new Map();
  for (const row of selected) {
    const values = [
        row.program || "Not recorded",
        row.yearLevel || "Not recorded",
        row.section || "Not recorded",
      ],
      key = JSON.stringify(values);
    if (!groups.has(key)) groups.set(key, { values, rows: [] });
    groups.get(key).rows.push(row);
  }
  const academic = book.addWorksheet("By academic group");
  academic.columns = [
    ["Program", 45],
    ["Year", 16],
    ["Section", 16],
    ["Registrations", 18],
    ...PARTICIPATION_STATUSES.filter((s) => s !== "Not Registered").map((s) => [
      s,
      18,
    ]),
  ].map(([header, width]) => ({ header, width }));
  for (const group of groups.values())
    academic.addRow([
      ...group.values,
      group.rows.length,
      ...PARTICIPATION_STATUSES.filter((s) => s !== "Not Registered").map(
        (status) => group.rows.filter((row) => row.status === status).length,
      ),
    ]);
  for (const sheet of book.worksheets) {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF245BA3" },
    };
    sheet.getRow(1).height = 28;
    sheet.eachRow(
      (row) => (row.alignment = { vertical: "middle", wrapText: true }),
    );
  }
  return book;
}
