export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export function expiryMillis(value) {
  return value?.toMillis?.() ?? value?.toDate?.()?.getTime() ?? new Date(value).getTime();
}
export function daysRemaining(expiresAt, now = Date.now()) {
  return Math.max(0, Math.ceil((expiryMillis(expiresAt) - now) / 86400000)) || 0;
}
export function canRestore(expiresAt, now = Date.now()) { return expiryMillis(expiresAt) > now; }
