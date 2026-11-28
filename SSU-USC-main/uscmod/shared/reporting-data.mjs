export const MAX_REPORT_ROWS = 50000;
export async function allPages(
  call,
  request,
  { maximum = MAX_REPORT_ROWS, onPage = () => {} } = {},
) {
  const rows = [],
    seen = new Set();
  let after = null,
    meta,
    startedAtMs;
  do {
    meta = await call("reportingPage", { ...request, after });
    startedAtMs ??= meta.nowMs;
    if (request.section === "attendance") {
      const snapshot = meta.event?.eligibilitySnapshotId || null;
      if (seen.has("__snapshot__") && snapshot !== seen.snapshot)
        throw Error(
          "Event eligibility changed during pagination. Reload the report.",
        );
      seen.add("__snapshot__");
      seen.snapshot = snapshot;
    }
    if (!Array.isArray(meta.rows)) throw Error("Invalid reporting response.");
    rows.push(...meta.rows);
    if (rows.length > maximum)
      throw Error(
        `This report exceeds ${maximum.toLocaleString()} records. Narrow the reporting scope.`,
      );
    onPage(rows.length);
    after = meta.next;
    if (after) {
      const key = JSON.stringify(after);
      if (seen.has(key)) throw Error("The reporting cursor did not advance.");
      seen.add(key);
    }
  } while (after);
  return { ...meta, rows, startedAtMs };
}
