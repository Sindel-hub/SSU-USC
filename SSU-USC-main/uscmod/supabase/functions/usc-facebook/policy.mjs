export function isAdministrator(profile, claims) {
  return profile?.role === 'admin' && claims?.role === 'admin' && profile.isActive !== false && profile.accountStatus === 'approved';
}
export function canPublish(profile, claims) {
  if (isAdministrator(profile, claims)) return true;
  if (profile?.role !== 'officer' || profile.isActive === false || profile.accountStatus !== 'approved' || (profile.studentStanding && profile.studentStanding !== 'active')) return false;
  const explicit = Array.isArray(profile.officerPermissions) && profile.officerPermissions.includes('bulletin.manage');
  if (profile.officerPermissionSource === 'custom') return explicit;
  return explicit || ['President','Vice President','Secretary','Public Relations Officer (PRO)'].includes(profile.officePosition);
}
export function deliveryMessage(post) {
  return `${String(post.title || '').trim()}\n\n${String(post.content || '').trim()}`;
}
export function withSurveyLink(message, surveyId, portalOrigin) {
  if (typeof surveyId !== 'string' || !/^[a-zA-Z0-9]{20}$/.test(surveyId)) return message;
  const url = new URL('/survey/index.html', portalOrigin);
  if (url.protocol !== 'https:') throw new Error('Facebook survey links require an HTTPS portal.');
  url.searchParams.set('id', surveyId);
  if (message.split(/\s+/).includes(url.href)) return message;
  return `${message}\n\nTake the survey: ${url.href}`;
}
export function retryable(status) { return status === 'failed'; }
