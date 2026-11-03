// Preview-only cleanup. Never change the stored/full announcement body.
export function announcementExcerpt(value, maxLength = 220) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n').replace(/\n(?:[\t ]*\n){2,}/g, '\n\n').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
