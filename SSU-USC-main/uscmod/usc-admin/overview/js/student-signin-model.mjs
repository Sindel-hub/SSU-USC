const clean = (value, fallback = '') => String(value ?? fallback).trim();
const toDate = value => { if (!value) return null; const date = value?.toDate ? value.toDate() : new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const SIGNIN_ANALYTICS_COLORS = [
  "#c36ee8", "#df83ed", "#ee9bed", "#ad3fc9", "#7d2aaa",
  "#5a73d9", "#3ca4d9", "#52b8a5", "#e2ad49", "#dc707e"
];

function sameLocalDay(value, reference = new Date()) {
  const date = toDate(value);
  return Boolean(date)
    && date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

export function summarizeStudentSignIns(records) {
  const groups = new Map();
  let sessions = 0;
  let activeToday = 0;
  let uniqueStudents = 0;
  let restoredHistorical = 0;
  const today = new Date();

  for (const item of records) {
    const department = clean(item.department, "Unspecified department");
    const signInCount = Math.max(0, Number(item.signInCount || 0));
    const hasSignedIn = signInCount > 0;
    const lastSignInAt = toDate(item.lastSignInAt);
    sessions += signInCount;
    if (hasSignedIn) uniqueStudents += 1;
    if (hasSignedIn && sameLocalDay(lastSignInAt, today)) activeToday += 1;
    if (hasSignedIn && item.legacyBackfill === true) restoredHistorical += 1;

    const current = groups.get(department) || {
      department,
      accountCount: 0,
      uniqueStudents: 0,
      sessions: 0,
      lastSignInAt: null
    };
    current.accountCount += 1;
    if (hasSignedIn) current.uniqueStudents += 1;
    current.sessions += signInCount;
    if (lastSignInAt && (!current.lastSignInAt || lastSignInAt > current.lastSignInAt)) {
      current.lastSignInAt = lastSignInAt;
    }
    groups.set(department, current);
  }

  const departments = [...groups.values()].sort((left, right) =>
    right.uniqueStudents - left.uniqueStudents
    || right.accountCount - left.accountCount
    || right.sessions - left.sessions
    || left.department.localeCompare(right.department)
  );
  departments.forEach((item, index) => {
    item.color = SIGNIN_ANALYTICS_COLORS[index % SIGNIN_ANALYTICS_COLORS.length];
    item.share = uniqueStudents ? item.uniqueStudents / uniqueStudents * 100 : 0;
  });

  return {
    knownAccounts: records.length,
    uniqueStudents,
    sessions,
    activeToday,
    restoredHistorical,
    departments
  };
}

export function buildDonutGradient(departments) {
  const visible = departments.filter((item) => item.share > 0);
  if (!visible.length) return "#e8f0f4";
  let cursor = 0;
  const stops = visible.map((item) => {
    const start = cursor;
    cursor += item.share;
    return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  if (cursor < 100) stops.push(`#e8f0f4 ${cursor.toFixed(2)}% 100%`);
  return `conic-gradient(${stops.join(", ")})`;
}
