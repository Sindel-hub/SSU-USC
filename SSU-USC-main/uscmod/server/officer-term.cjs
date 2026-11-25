"use strict";
// Only explicitly adopted assignments use the expected-date policy. Historical
// fixed cutoffs remain enforced until an administrator authorizes conversion.
const POLICY = "until-turnover";
function active(a, now) {
  return a?.status === "active" && Number.isSafeInteger(a.startsAtMs) && a.startsAtMs <= now
    && a.actualEndsAtMs == null
    && (a.termPolicy === POLICY || (Number.isSafeInteger(a.endsAtMs) && a.endsAtMs > now));
}
function expectedEnd(startsAtMs) {
  if (!Number.isSafeInteger(startsAtMs) || !Number.isFinite(new Date(startsAtMs).getTime())) return NaN;
  // Philippine calendar anniversary, clamped to February 28 for leap-day term start.
  const local = new Date(startsAtMs + 8 * 3600000);
  const year = local.getUTCFullYear() + 1, month = local.getUTCMonth();
  const day = Math.min(local.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return Date.UTC(year, month, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) - 8 * 3600000;
}
module.exports = { POLICY, active, expectedEnd };
