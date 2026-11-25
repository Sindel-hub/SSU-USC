"use strict";
// Only explicitly adopted assignments use the expected-date policy. Historical
// fixed cutoffs remain enforced until an administrator authorizes conversion.
const POLICY = "until-turnover";
function active(a, now) {
  return a?.status === "active" && Number.isSafeInteger(a.startsAtMs) && a.startsAtMs <= now
    && a.actualEndsAtMs == null
    && (a.termPolicy === POLICY || (Number.isSafeInteger(a.endsAtMs) && a.endsAtMs > now));
}
function expectedEnd(administration) {
  const match = typeof administration === "string" && /^(\d{4})\s*[-–—]\s*(\d{4})$/.exec(administration.trim());
  if (!match || Number(match[2]) !== Number(match[1]) + 1 || Number(match[1]) < 1900 || Number(match[2]) > 9999) return null;
  return `${match[2]}-03`;
}
function expectedMonth(a) {
  return a.expectedEndMonth || (a.status === "active" && a.termPolicy === POLICY ? expectedEnd(a.administration) : null);
}
function awaitingTurnover(a, now) {
  const expected = expectedMonth(a);
  if (expected) {
    const local = new Date(now + 8 * 3600000);
    const month = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
    return month > expected;
  }
  return Number.isFinite(a.expectedEndsAtMs) && a.expectedEndsAtMs <= now;
}
module.exports = { POLICY, active, expectedEnd, expectedMonth, awaitingTurnover };
