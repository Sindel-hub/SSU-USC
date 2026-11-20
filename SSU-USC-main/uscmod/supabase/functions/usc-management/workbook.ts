import { parseCsv } from "../../../shared/student-import-model.mjs";
// Bound XLSX expansion before handing the ZIP archive to ExcelJS.
export function validateWorkbookArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0,
    entries = 0;
  for (let i = 0; i + 46 <= bytes.length; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      const size = view.getUint32(i + 24, true),
        name = view.getUint16(i + 28, true),
        extra = view.getUint16(i + 30, true),
        comment = view.getUint16(i + 32, true);
      total += size;
      entries++;
      if (size === 0xffffffff || total > 32 * 1024 * 1024 || entries > 100)
        throw Error("Workbook expands beyond the safe import limit. Use CSV.");
      i += 45 + name + extra + comment;
    }
  if (!entries) throw Error("Invalid XLSX archive.");
}
export async function parseFile(file: any) {
  if (!file || typeof file.base64 !== "string" || file.base64.length > 7000000)
    throw Error("Upload a CSV/XLSX file of at most 5 MB.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  } catch {
    throw Error("Malformed file upload.");
  }
  if (bytes.length > 5 * 1024 * 1024) throw Error("File exceeds 5 MB.");
  if (/\.csv$/i.test(file.name))
    return parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!/\.xlsx$/i.test(file.name))
    throw Error("Only CSV and XLSX are supported.");
  validateWorkbookArchive(bytes);
  // Central-directory sizes can be forged. Bound actual streamed expansion too.
  const { default: unzipper } = await import("npm:unzipper@0.10.14");
  const { Buffer } = await import("node:buffer");
  const archive = await unzipper.Open.buffer(Buffer.from(bytes));
  let expanded = 0;
  if (archive.files.length > 100) throw Error("Too many workbook entries.");
  for (const entry of archive.files) {
    const stream = entry.stream();
    try {
      for await (const chunk of stream) {
        expanded += chunk.length;
        if (expanded > 32 * 1024 * 1024)
          throw Error(
            "Workbook expands beyond the safe import limit. Use CSV.",
          );
      }
    } finally {
      stream.destroy();
    }
  }
  const { default: ExcelJS } = await import("npm:exceljs@4.4.0");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as any);
  const sheet = workbook.worksheets[0];
  if (
    workbook.worksheets.length !== 1 ||
    !sheet ||
    sheet.rowCount > 5001 ||
    sheet.columnCount > 8
  )
    throw Error(
      "Use one worksheet, eight columns, and at most 5,000 student rows.",
    );
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values: string[] = [];
    for (let c = 1; c <= 8; c++) {
      const cell = row.getCell(c);
      if (
        cell.type === ExcelJS.ValueType.Formula ||
        cell.type === ExcelJS.ValueType.Error
      )
        throw Error("Formulas and error cells are not allowed.");
      if (c === 1 && typeof cell.value === "number")
        throw Error(
          "Format Student ID cells as Text before entering IDs, to preserve leading zeros.",
        );
      values.push(cell.text || "");
    }
    rows.push(values);
  });
  return rows;
}
