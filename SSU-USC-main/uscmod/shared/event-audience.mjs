export function matchesEventAudience(event, profile) {
  if (event?.audience !== "Selected Group" || !event.audienceScope) return true;
  if (!profile || !event.audienceCollege || profile.college !== event.audienceCollege) return false;
  if (event.audienceScope === "college") return true;
  return event.audienceScope === "program" && Boolean(event.audienceProgram) && profile.program === event.audienceProgram;
}

/** Targeting is informational for visibility and participation; matching is for alert routing only. */
export function eventAudienceLabel(event) {
  if (event?.sourceType === "program" || event?.audience !== "Selected Group") return "All Students";
  if (event.audienceScope === "program" && event.audienceProgram) return [event.audienceProgram,event.audienceCollege].filter(Boolean).join(" · ");
  return event.audienceCollege || "Selected group (not specified)";
}
