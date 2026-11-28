export const PARTICIPATION_STATUSES = Object.freeze([
  "Not Registered",
  "Registered",
  "Checked In",
  "Completed",
  "Incomplete",
  "Absent",
]);
export function milliseconds(value) {
  if (typeof value === "number") return value;
  return (
    value?.toMillis?.() ??
    value?.toDate?.()?.getTime() ??
    (value ? new Date(value).getTime() : 0)
  );
}
export function academicSnapshot(profile = {}) {
  return Object.fromEntries(
    ["studentId", "fullName", "college", "program", "yearLevel", "section"].map(
      (key) => [
        key,
        String(
          profile[key] || (key === "college" ? profile.department : "") || "",
        ).trim(),
      ],
    ),
  );
}
export function eligibleForEvent(event, profile) {
  const target = event.targetParticipants || {};
  return ["college", "program", "yearLevel", "section"].every(
    (key) =>
      !target[key]?.length ||
      target[key].includes(academicSnapshot(profile)[key]),
  );
}
export function participationStatus(record, event, now = Date.now()) {
  if (!record) return "Not Registered";
  if (record.timeOutAtMs != null) return "Completed";
  const closing = milliseconds(
    record.attendanceClosesAtMs ||
      (record.schemaVersion === 1 ? event.timeOutClosesAtMs : 0),
  );
  const closed = closing > 0 && now >= closing;
  if (record.timeInAtMs != null) return closed ? "Incomplete" : "Checked In";
  return closed ? "Absent" : "Registered";
}
export function registrationState(event, profile, record, now = Date.now()) {
  if (record) return participationStatus(record, event, now);
  if(event.eligibilityPolicyVersion===1&&event.eligibilitySnapshotState!=='ready')return 'Preparing registration';
  if (!eligibleForEvent(event, profile)) return "Not Eligible";
  if (
    now >=
    milliseconds(
      event.timeOutClosesAtMs ||
        `${event.eventDate}T${event.endTime || "23:59"}:00+08:00`,
    )
  )
    return "Event Completed";
  if (now < milliseconds(event.registrationOpensAtMs))
    return "Registration Not Yet Open";
  if (
    now >=
    milliseconds(event.registrationClosesAtMs || event.registrationDeadline)
  )
    return "Registration Closed";
  return "Register";
}
export function attendanceDuration(record) {
  return record?.timeInAtMs != null && record?.timeOutAtMs != null
    ? Math.max(0, record.timeOutAtMs - record.timeInAtMs)
    : null;
}
export function manilaTime(value) {
  const ms = milliseconds(value);
  return ms
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(ms)
    : "—";
}
export function durationLabel(value) {
  if (value == null) return "—";
  const minutes = Math.floor(value / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function validateParticipationSchedule(input) {
  const fields = [
    "registrationOpensAtMs",
    "registrationClosesAtMs",
    "timeInOpensAtMs",
    "timeInClosesAtMs",
    "timeOutOpensAtMs",
    "timeOutClosesAtMs",
  ];
  if (
    !fields.every((key) => Number.isSafeInteger(input[key]) && input[key] > 0)
  )
    throw Error("Complete all registration and attendance schedules.");
  if (
    input.registrationOpensAtMs >= input.registrationClosesAtMs ||
    input.timeInOpensAtMs >= input.timeInClosesAtMs ||
    input.timeOutOpensAtMs >= input.timeOutClosesAtMs ||
    input.timeOutOpensAtMs < input.timeInOpensAtMs ||
    input.timeOutClosesAtMs < input.timeInClosesAtMs ||
    input.registrationClosesAtMs > input.timeOutClosesAtMs
  )
    throw Error("Check registration and attendance schedule order.");
  const target = input.targetParticipants || {};
  if (
    typeof target !== "object" ||
    Array.isArray(target) ||
    Object.keys(target).some(
      (key) => !["college", "program", "yearLevel", "section"].includes(key),
    )
  )
    throw Error("Invalid participant groups.");
  const result = Object.fromEntries(fields.map((key) => [key, input[key]]));
  result.targetParticipants = {};
  for (const key of ["college", "program", "yearLevel", "section"]) {
    const values = target[key] || [];
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      values.some(
        (value) =>
          typeof value !== "string" || !value.trim() || value.length > 160,
      )
    )
      throw Error("Invalid participant groups.");
    result.targetParticipants[key] = [
      ...new Set(values.map((value) => value.trim())),
    ];
  }
  return {
    ...result,
    participationVersion: 1,
    registrationMode: "internal",
    externalRegistrationUrl: "",
  };
}
