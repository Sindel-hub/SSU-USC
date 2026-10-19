// Internal Firebase identifiers are never contact or institutional email addresses.
export function isInternalAuthEmail(value) {
  return /@(?:student\.)?ssu-usc\.local$/i.test(String(value || '').trim());
}
export function institutionalEmailForDisplay(profile = {}) {
  const email = String(profile.institutionalEmail || profile.email || '').trim().toLowerCase();
  return isInternalAuthEmail(email) ? '' : email;
}
export function validateInstitutionalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 200 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ssu\.edu\.ph$/.test(email)) {
    throw new Error('Enter your university-issued @ssu.edu.ph email address.');
  }
  return email;
}
