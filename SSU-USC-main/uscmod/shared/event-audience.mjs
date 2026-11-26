export function matchesEventAudience(event, profile) {
  if (event?.audience !== "Selected Group" || !event.audienceScope) return true;
  if (!profile || !event.audienceCollege || profile.college !== event.audienceCollege) return false;
  if (event.audienceScope === "college") return true;
  return event.audienceScope === "program" && Boolean(event.audienceProgram) && profile.program === event.audienceProgram;
}
