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
export function retryable(status) { return status === 'failed'; }
