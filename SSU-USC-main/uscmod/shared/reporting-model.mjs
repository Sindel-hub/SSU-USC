import {
  academicSnapshot,
  participationStatus,
  milliseconds,
} from "./event-participation-model.mjs";
export const REPORT_LEVELS = ["college", "program", "yearLevel", "section"];
export const COMPLAINT_STATUSES = [
  "Submitted",
  "Under Review",
  "In Progress",
  "Resolved",
  "Closed",
];
export function ratio(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}
export function percentage(value) {
  return value == null ? "N/A" : `${value.toFixed(2)}%`;
}
export function day(value) {
  const ms = milliseconds(value);
  return ms
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ms))
    : "";
}
export function matchesScope(row, filters = {}) {
  return REPORT_LEVELS.every(
    (key) =>
      !filters[key] ||
      (filters[key] === "__missing__" ? !row[key] : row[key] === filters[key]),
  );
}
export function eventMatches(event, filters = {}) {
  const date = event.eventDate || event.archivedEventDate || "";
  return (
    (!filters.academicYear || event.academicYear === filters.academicYear) &&
    (!filters.semester || event.semester === filters.semester) &&
    (!filters.from || date >= filters.from) &&
    (!filters.until || date <= filters.until)
  );
}
export function attendanceRows(
  event,
  population,
  registrations,
  now = Date.now(),
  complete = true,
) {
  const saved = new Map();
  for (const row of registrations) {
    const uid = row.studentUid || row.uid;
    if (uid && !saved.has(uid)) saved.set(uid, row);
  }
  const eligible = new Map();
  for (const row of population) {
    if (row.uid && !eligible.has(row.uid)) eligible.set(row.uid, row);
  }
  if (complete && [...saved.keys()].some((uid) => !eligible.has(uid)))
    throw Error(
      "Eligibility history is incomplete for registered students. This report cannot be finalized.",
    );
  const entries = complete
    ? [...eligible.values()]
    : [...saved].map(([uid, row]) => ({
        uid,
        ...(row.academicSnapshot || academicSnapshot(row)),
      }));
  return entries.map((profile) => {
    const record = saved.get(profile.uid);
    const academic = complete
      ? academicSnapshot(profile)
      : record?.academicSnapshot || academicSnapshot(record);
    return {
      uid: profile.uid,
      eventId: event.id,
      source: event.source,
      eventTitle: event.title,
      eventDate: event.eventDate || event.archivedEventDate,
      ...academic,
      registered: Boolean(record),
      registeredAtMs:
        record?.registeredAtMs || milliseconds(record?.registeredAt),
      timeInAtMs: record?.timeInAtMs ?? null,
      timeOutAtMs: record?.timeOutAtMs ?? null,
      durationMs:
        record?.timeInAtMs != null && record?.timeOutAtMs != null
          ? record.timeOutAtMs - record.timeInAtMs
          : null,
      timeInOfficerUid: record?.timeInOfficerUid || "",
      timeOutOfficerUid: record?.timeOutOfficerUid || "",
      status: participationStatus(record, event, now),
      eligible: complete ? true : null,
    };
  });
}
export function attendanceStatistics(
  rows,
  { complete = true, closed = false } = {},
) {
  const unique = [
    ...new Map(
      rows.map((row) => [
        `${row.source || ""}/${row.eventId || ""}/${row.uid}`,
        row,
      ]),
    ).values(),
  ];
  const eligible = complete ? unique.length : null,
    registered = unique.filter((r) => r.registered).length,
    attended = unique.filter((r) => r.timeInAtMs != null).length,
    completed = unique.filter((r) => r.status === "Completed").length;
  const counts = Object.fromEntries(
    [
      "Not Registered",
      "Registered",
      "Checked In",
      "Completed",
      "Incomplete",
      "Absent",
    ].map((status) => [
      status,
      unique.filter((r) => r.status === status).length,
    ]),
  );
  return {
    eligible,
    registered,
    unregistered: complete ? eligible - registered : null,
    attended,
    completed,
    checkedIn: counts["Checked In"],
    incomplete: counts.Incomplete,
    absent: counts.Absent,
    participationRate: eligible == null ? null : ratio(attended, eligible),
    registrationRate: eligible == null ? null : ratio(registered, eligible),
    attendanceRate: ratio(attended, registered),
    completionRate: ratio(completed, attended),
    absenceRate: closed ? ratio(counts.Absent, registered) : null,
    incompleteRate: closed ? ratio(counts.Incomplete, attended) : null,
    counts,
    uniqueAttendees: new Set(
      unique.filter((r) => r.timeInAtMs != null).map((r) => r.uid),
    ).size,
    studentEventRegistrations: registered,
    studentEventAttendances: attended,
    eligibleStudentEventOpportunities: eligible,
  };
}
export function attendanceView(rows, filters = {}, options = {}) {
  const cohort = rows.filter((row) => matchesScope(row, filters));
  const selected = cohort.filter(
    (row) =>
      (!filters.status || row.status === filters.status) &&
      (!filters.search ||
        `${row.studentId} ${row.fullName}`
          .toLowerCase()
          .includes(filters.search.toLowerCase())),
  );
  return {
    rows: selected,
    statistics: attendanceStatistics(selected, options),
  };
}
export function attendanceBreakdown(rows, key, options = {}) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key] || "__missing__";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, records]) => ({
      value,
      label: value === "__missing__" ? "Not recorded" : value,
      ...attendanceStatistics(records, options),
    }));
}
export function complaintResolved(row) {
  return (
    row.status === "Resolved" ||
    (row.status === "Closed" && row.resolutionOutcome === "resolved")
  );
}
export function complaintMetrics(rows, now = Date.now()) {
  const counts = Object.fromEntries(
    COMPLAINT_STATUSES.map((status) => [
      status,
      rows.filter((r) => r.status === status).length,
    ]),
  );
  const resolved = rows.filter(complaintResolved),
    durations = resolved
      .filter((r) => r.createdAtMs > 0 && r.resolvedAtMs >= r.createdAtMs)
      .map((r) => r.resolvedAtMs - r.createdAtMs);
  const ages = rows
    .filter((r) => r.createdAtMs > 0 && r.createdAtMs <= now)
    .map((r) => now - r.createdAtMs);
  return {
    total: rows.length,
    counts,
    resolved: resolved.length,
    resolutionRate: ratio(resolved.length, rows.length),
    averageResolutionMs: durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
    resolutionSamples: durations.length,
    averageAgeMs: ages.length
      ? ages.reduce((a, b) => a + b, 0) / ages.length
      : null,
    assigned: rows.filter((r) => r.assigned).length,
    unassigned: rows.filter((r) => !r.assigned).length,
  };
}
export function complaintMatches(row, filters = {}) {
  const created = day(row.createdAtMs),
    resolved = day(row.resolvedAtMs);
  return (
    (!filters.status || row.status === filters.status) &&
    (!filters.college ||
      (filters.college === "__missing__"
        ? !row.college
        : row.college === filters.college)) &&
    (!filters.officer || row.assignedOfficer === filters.officer) &&
    (!filters.search ||
      `${row.reference || ""} ${row.subject || ""}`
        .toLowerCase()
        .includes(filters.search.toLowerCase())) &&
    (!filters.from || created >= filters.from) &&
    (!filters.until || created <= filters.until) &&
    (!filters.resolvedFrom || (resolved && resolved >= filters.resolvedFrom)) &&
    (!filters.resolvedUntil || (resolved && resolved <= filters.resolvedUntil))
  );
}
export function complaintBreakdown(rows, key, denominator = rows.length) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key] || "__missing__";
    groups.set(value, (groups.get(value) || 0) + 1);
  }
  return [...groups]
    .map(([value, count]) => ({
      value,
      label: value === "__missing__" ? "Not recorded" : value,
      count,
      percentage: ratio(count, denominator),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
export function monthlyTrend(rows, dateKey) {
  const map = new Map();
  for (const row of rows) {
    const month = day(row[dateKey]).slice(0, 7);
    if (month) map.set(month, (map.get(month) || 0) + 1);
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count }));
}
